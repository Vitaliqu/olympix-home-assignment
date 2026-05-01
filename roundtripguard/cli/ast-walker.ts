import { parse, visit } from "@solidity-parser/parser";
import type { ScalingPair } from "./rules";
import { evaluatePair, isSwapFunction } from "./rules";

export interface AstRoundingCall {
  functionName: string;
  line: number;
  col: number;
  callType: "mul" | "div";
  roundingDir: "down" | "up";
  dynamicRate?: boolean;
}

export interface AuditFinding {
  file: string;
  pairs: ScalingPair[];
  rawCalls: AstRoundingCall[];
}

export interface WalkOptions {
  swapPatterns?: string[];
  dynamicRateFunctions?: string[];
}

const MUL_FNS = new Set(["mulDown", "mulUp"]);
const DIV_FNS = new Set(["divDown", "divUp"]);

const DEFAULT_DYNAMIC_RATE_FNS = new Set([
  "getrate", "scalingfactor", "getrateprovider", "rate", "getscalingfactor",
]);

function methodName(node: any): string | null {
  if (node?.type !== "FunctionCall") return null;
  const expr = node.expression;
  if (expr?.type === "MemberAccess") return expr.memberName ?? null;
  if (expr?.type === "Identifier") return expr.name ?? null;
  return null;
}

function calleeNameLower(node: any): string | null {
  const expr = node?.expression;
  if (!expr) return null;
  if (expr.type === "MemberAccess") return (expr.memberName ?? "").toLowerCase();
  if (expr.type === "Identifier") return (expr.name ?? "").toLowerCase();
  return null;
}

function isDynamicRateArg(node: any, rateSet: Set<string>): boolean {
  const args: any[] = node.arguments ?? [];
  const expr = node.expression;
  const isMember = expr?.type === "MemberAccess";
  // For member calls (a.mulDown(b)), the scaling arg is args[0]
  // For plain calls (mulDown(a, b)), the scaling arg is args[1]
  const scaleArg = isMember ? args[0] : args[1];
  if (!scaleArg) return false;
  if (scaleArg.type !== "FunctionCall") return false;
  const name = calleeNameLower(scaleArg);
  return name !== null && rateSet.has(name);
}

function toRoundingCall(node: any, dynamicRateFnSet: Set<string>): AstRoundingCall | null {
  const name = methodName(node);
  if (!name) return null;
  const isMul = MUL_FNS.has(name);
  const isDiv = DIV_FNS.has(name);
  if (!isMul && !isDiv) return null;
  return {
    functionName: name,
    line: node.loc?.start?.line ?? 0,
    col: node.loc?.start?.column ?? 0,
    callType: isMul ? "mul" : "div",
    roundingDir: name.endsWith("Down") ? "down" : "up",
    dynamicRate: isMul ? isDynamicRateArg(node, dynamicRateFnSet) : undefined,
  };
}

interface TaintEntry {
  mulFunctionName: string;
  sourceLine: number;
  sourceCol: number;
  dynamicRate?: boolean;
  varPath: string[]; // variable names traversed from initial mul assignment to current holder
}

interface FnState {
  calls: AstRoundingCall[];
  isSwap: boolean;
  taintMap: Map<string, TaintEntry>;
  taintedPairs: ScalingPair[];
  supersededMulLines: Set<string>; // line:col keys of mul calls that were overwritten by reassignment
}

function assignmentLhsName(node: any): string | null {
  if (node.type === "VariableDeclarationStatement") {
    const vars: any[] = node.variables ?? [];
    if (vars.length === 1 && vars[0]?.name) return vars[0].name;
  }
  if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (expr?.type === "BinaryOperation" && expr.operator === "=") {
      const lhs = expr.left;
      if (lhs?.type === "Identifier") return lhs.name;
    }
  }
  return null;
}

function assignmentRhsFunctionCall(node: any): any | null {
  let rhs: any = null;
  if (node.type === "VariableDeclarationStatement") {
    rhs = node.initialValue;
  } else if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (expr?.type === "BinaryOperation" && expr.operator === "=") rhs = expr.right;
  }
  if (!rhs) return null;
  if (rhs.type === "FunctionCall") return rhs;
  return null;
}

function getRhsNode(node: any): any | null {
  if (node.type === "VariableDeclarationStatement") return node.initialValue ?? null;
  if (node.type === "ExpressionStatement") {
    const expr = node.expression;
    if (expr?.type === "BinaryOperation" && expr.operator === "=") return expr.right;
  }
  return null;
}

// First-match wins: returns the first tainted identifier found via DFS.
// For expressions combining multiple tainted variables (e.g., tainted1 + tainted2),
// the result depends on traversal order (left-before-right). This is an acceptable
// simplification for the PoC; upgrade to union tracking if multi-taint accuracy is needed.
function findTaintedVarInExpr(node: any, taintMap: Map<string, TaintEntry>): TaintEntry | null {
  if (!node) return null;
  if (node.type === "Identifier" && taintMap.has(node.name)) {
    return taintMap.get(node.name)!;
  }
  // Do not propagate taint through mul/div call arguments — those are fresh rounding operations
  if (node.type === "FunctionCall") {
    const name = methodName(node);
    if (name && (MUL_FNS.has(name) || DIV_FNS.has(name))) return null;
  }
  for (const key of ["left", "right", "expression", "base", "index"]) {
    const child = node[key];
    if (child && typeof child === "object") {
      const found = findTaintedVarInExpr(child, taintMap);
      if (found) return found;
    }
  }
  if (Array.isArray(node.arguments)) {
    for (const arg of node.arguments) {
      const found = findTaintedVarInExpr(arg, taintMap);
      if (found) return found;
    }
  }
  return null;
}

function checkDivCallForTaint(node: any, fnName: string, state: FnState): void {
  const divName = methodName(node);
  if (!divName || !DIV_FNS.has(divName)) return;

  const expr = node.expression;
  const isMember = expr?.type === "MemberAccess";

  let taintedVarName: string | null = null;
  if (isMember) {
    const receiver = expr.expression;
    if (receiver?.type === "Identifier") taintedVarName = receiver.name;
  } else {
    const args: any[] = node.arguments ?? [];
    const firstArg = args[0];
    if (firstArg?.type === "Identifier") taintedVarName = firstArg.name;
  }

  if (!taintedVarName) return;
  const taint = state.taintMap.get(taintedVarName);
  if (!taint) return;

  const evaluation = evaluatePair(taint.mulFunctionName, divName, state.isSwap);
  if (evaluation.severity === "OK") return;

  state.taintedPairs.push({
    swapFunction: fnName,
    upscale: {
      functionName: taint.mulFunctionName,
      line: taint.sourceLine,
      col: taint.sourceCol,
      context: "upscale",
      dynamicRate: taint.dynamicRate,
    },
    downscale: {
      functionName: divName,
      line: node.loc?.start?.line ?? 0,
      col: node.loc?.start?.column ?? 0,
      context: "downscale",
    },
    taintPath: taint.varPath,
    ...evaluation,
  });
}

function processStatement(stmt: any, fnName: string, state: FnState, dynamicRateFnSet: Set<string>): void {
  if (!stmt) return;

  const lhsName = assignmentLhsName(stmt);
  const rhsCall = assignmentRhsFunctionCall(stmt);

  if (lhsName !== null) {
    // If this variable already holds a taint, mark the old mul call as superseded
    const existingTaint = state.taintMap.get(lhsName);
    if (existingTaint) {
      state.supersededMulLines.add(`${existingTaint.sourceLine}:${existingTaint.sourceCol}`);
    }

    if (rhsCall) {
      const name = methodName(rhsCall);
      if (name && MUL_FNS.has(name)) {
        // RHS is a mul call — store new taint
        state.taintMap.set(lhsName, {
          mulFunctionName: name,
          sourceLine: rhsCall.loc?.start?.line ?? 0,
          sourceCol: rhsCall.loc?.start?.column ?? 0,
          dynamicRate: isDynamicRateArg(rhsCall, dynamicRateFnSet),
          varPath: [lhsName],
        });
        return;
      }
      if (name && DIV_FNS.has(name)) {
        // RHS is a div call — check if the receiver/arg is tainted (e.g. amountIn = tainted.divDown(...))
        checkDivCallForTaint(rhsCall, fnName, state);
        state.taintMap.delete(lhsName);
        return;
      }
    }
    // Check if RHS expression contains a reference to a tainted variable (propagation)
    const rhsNode = getRhsNode(stmt);
    if (rhsNode) {
      const referencedTaint = findTaintedVarInExpr(rhsNode, state.taintMap);
      if (referencedTaint) {
        state.taintMap.set(lhsName, {
          ...referencedTaint,
          varPath: [...referencedTaint.varPath, lhsName],
        });
        return;
      }
    }
    state.taintMap.delete(lhsName);
    return;
  }

  if (stmt.type === "ExpressionStatement" && stmt.expression?.type === "FunctionCall") {
    checkDivCallForTaint(stmt.expression, fnName, state);
  }
  if (stmt.type === "ReturnStatement" && stmt.expression?.type === "FunctionCall") {
    checkDivCallForTaint(stmt.expression, fnName, state);
  }
  // Edge case: tuple-destructure VariableDeclarationStatement (lhsName is null for multi-variable forms).
  // Checks if the initializer is directly a div call on a tainted receiver.
  if (stmt.type === "VariableDeclarationStatement" && stmt.initialValue?.type === "FunctionCall") {
    checkDivCallForTaint(stmt.initialValue, fnName, state);
  }
}

export function walkSource(
  fileName: string,
  source: string,
  options: WalkOptions = {}
): AuditFinding {
  let ast: any;
  try {
    ast = parse(source, { loc: true, range: true, tolerant: true });
  } catch {
    return { file: fileName, pairs: [], rawCalls: [] };
  }

  const swapPatterns = options.swapPatterns;
  const dynamicRateFnSet: Set<string> = options.dynamicRateFunctions
    ? new Set(options.dynamicRateFunctions.map((f) => f.toLowerCase()))
    : DEFAULT_DYNAMIC_RATE_FNS;

  const allCalls: AstRoundingCall[] = [];
  const callsByFn = new Map<string, FnState>();
  let currentFn = "";
  let currentState: FnState | null = null;

  visit(ast, {
    FunctionDefinition: (node: any) => {
      currentFn = node.name ?? "(anonymous)";
      const isSwap = isSwapFunction(currentFn, swapPatterns);
      currentState = { calls: [], isSwap, taintMap: new Map(), taintedPairs: [], supersededMulLines: new Set() };
      callsByFn.set(currentFn, currentState);

      const body = node.body;
      if (body?.type === "Block") {
        for (const stmt of body.statements ?? []) {
          processStatement(stmt, currentFn, currentState, dynamicRateFnSet);
        }
      }
    },
    "FunctionDefinition:exit": () => {
      currentFn = "";
      currentState = null;
    },
    FunctionCall: (node: any) => {
      if (!currentFn) return;
      const call = toRoundingCall(node, dynamicRateFnSet);
      if (!call) return;
      allCalls.push(call);
      if (currentState) currentState.calls.push(call);
    },
  });

  const pairs: ScalingPair[] = [];

  for (const [fnName, state] of callsByFn.entries()) {
    pairs.push(...state.taintedPairs);

    const taintPairedUpscaleLines = new Set(state.taintedPairs.map((p) => `${p.upscale.line}:${p.upscale.col}`));

    const sorted = [...state.calls].sort((a, b) =>
      a.line !== b.line ? a.line - b.line : a.col - b.col
    );
    const divCalls = sorted.filter((c) => c.callType === "div");

    for (const mul of sorted.filter((c) => c.callType === "mul")) {
      if (taintPairedUpscaleLines.has(`${mul.line}:${mul.col}`)) continue;
      if (state.supersededMulLines.has(`${mul.line}:${mul.col}`)) continue;

      const nextDiv = divCalls.find(
        (d) => d.line > mul.line || (d.line === mul.line && d.col > mul.col)
      );
      if (!nextDiv) continue;

      const evaluation = evaluatePair(mul.functionName, nextDiv.functionName, state.isSwap);
      if (evaluation.severity === "OK") continue;

      pairs.push({
        swapFunction: fnName,
        upscale: {
          functionName: mul.functionName,
          line: mul.line,
          col: mul.col,
          context: "upscale",
          dynamicRate: mul.dynamicRate,
        },
        downscale: {
          functionName: nextDiv.functionName,
          line: nextDiv.line,
          col: nextDiv.col,
          context: "downscale",
        },
        ...evaluation,
      });
    }
  }

  return { file: fileName, pairs, rawCalls: allCalls };
}
