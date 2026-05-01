import { toJson, toMarkdown, enrichWithClaude } from "../reporter";
import type { AuditFinding } from "../ast-walker";
import type { ScalingPair } from "../rules";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────
const CRITICAL_PAIR: ScalingPair = {
  swapFunction: "swapGivenOut",
  upscale:   { functionName: "mulDown", line: 10, col: 4, context: "upscale" },
  downscale: { functionName: "divDown", line: 12, col: 4, context: "downscale" },
  isAsymmetric: true,
  severity: "CRITICAL",
  description: "mulDown (upscale) + divDown (downscale): both round toward zero. Net bias ~1 wei/swap favours the caller. At balance < 1e6 / SCALING_FACTOR wei, upscaled amountOut rounds to 0 → scaledIn = 0 → amountIn = 0 (free extraction). Pool fully drained in O(reserve) micro-swaps.",
};

const WARNING_PAIR: ScalingPair = {
  swapFunction: "onSwap",
  upscale:   { functionName: "mulUp", line: 20, col: 4, context: "upscale" },
  downscale: { functionName: "divUp", line: 22, col: 4, context: "downscale" },
  isAsymmetric: true,
  severity: "WARNING",
  description: "mulUp (upscale) + divUp (downscale): both round away from zero. Bias favours the protocol.",
};

const finding_empty: AuditFinding = { file: "Clean.sol", pairs: [], rawCalls: [] };
const finding_critical: AuditFinding = { file: "VulnPool.sol", pairs: [CRITICAL_PAIR], rawCalls: [] };
const finding_warning: AuditFinding = { file: "WarnPool.sol", pairs: [WARNING_PAIR], rawCalls: [] };
const finding_both: AuditFinding = { file: "Both.sol", pairs: [CRITICAL_PAIR, WARNING_PAIR], rawCalls: [] };

// ─────────────────────────────────────────────────────────────
// toJson
// ─────────────────────────────────────────────────────────────
describe("toJson", () => {
  it("returns an object with a tool field", () => {
    const result = toJson([]) as any;
    expect(typeof result.tool).toBe("string");
    expect(result.tool.length).toBeGreaterThan(0);
  });

  it("empty findings array → findings: []", () => {
    const result = toJson([]) as any;
    expect(result.findings).toEqual([]);
  });

  it("clean file → criticalCount 0, warningCount 0", () => {
    const result = toJson([finding_empty]) as any;
    expect(result.findings[0].criticalCount).toBe(0);
    expect(result.findings[0].warningCount).toBe(0);
  });

  it("critical finding → criticalCount 1, warningCount 0", () => {
    const result = toJson([finding_critical]) as any;
    expect(result.findings[0].criticalCount).toBe(1);
    expect(result.findings[0].warningCount).toBe(0);
  });

  it("warning finding → criticalCount 0, warningCount 1", () => {
    const result = toJson([finding_warning]) as any;
    expect(result.findings[0].criticalCount).toBe(0);
    expect(result.findings[0].warningCount).toBe(1);
  });

  it("mixed finding → criticalCount 1, warningCount 1", () => {
    const result = toJson([finding_both]) as any;
    expect(result.findings[0].criticalCount).toBe(1);
    expect(result.findings[0].warningCount).toBe(1);
  });

  it("preserves file name", () => {
    const result = toJson([finding_critical]) as any;
    expect(result.findings[0].file).toBe("VulnPool.sol");
  });

  it("includes pairs array in each finding entry", () => {
    const result = toJson([finding_critical]) as any;
    expect(Array.isArray(result.findings[0].pairs)).toBe(true);
    expect(result.findings[0].pairs).toHaveLength(1);
  });

  it("multiple files are all present", () => {
    const result = toJson([finding_empty, finding_critical, finding_warning]) as any;
    expect(result.findings).toHaveLength(3);
    const files = result.findings.map((f: any) => f.file);
    expect(files).toContain("Clean.sol");
    expect(files).toContain("VulnPool.sol");
    expect(files).toContain("WarnPool.sol");
  });

  it("result is JSON-serialisable (no circular refs)", () => {
    expect(() => JSON.stringify(toJson([finding_both]))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// toMarkdown
// ─────────────────────────────────────────────────────────────
describe("toMarkdown", () => {
  it("returns a non-empty string", () => {
    expect(typeof toMarkdown([])).toBe("string");
    expect(toMarkdown([]).length).toBeGreaterThan(0);
  });

  it("starts with a markdown heading", () => {
    expect(toMarkdown([]).startsWith("#")).toBe(true);
  });

  it("clean file → exit code 0", () => {
    const md = toMarkdown([finding_empty]);
    expect(md).toMatch(/Exit code.*0/i);
    expect(md).not.toMatch(/Exit code.*1/i);
  });

  it("critical finding → exit code 1", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toMatch(/Exit code.*1/i);
  });

  it("warning-only → exit code 0 (warnings don't trigger exit 1)", () => {
    const md = toMarkdown([finding_warning]);
    expect(md).toMatch(/Exit code.*0/i);
  });

  it("critical finding → 🔴 emoji present", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toContain("🔴");
  });

  it("warning finding → 🟡 emoji present", () => {
    const md = toMarkdown([finding_warning]);
    expect(md).toContain("🟡");
  });

  it("contains file name for the finding", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toContain("VulnPool.sol");
  });

  it("contains function name from the pair", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toContain("swapGivenOut");
  });

  it("contains upscale function name and line number", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toContain("mulDown");
    expect(md).toContain("10");
  });

  it("contains downscale function name and line number", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toContain("divDown");
    expect(md).toContain("12");
  });

  it("clean file says no scaling pairs", () => {
    const md = toMarkdown([finding_empty]);
    expect(md).toMatch(/no scaling pairs/i);
  });

  it("contains the finding description", () => {
    const md = toMarkdown([finding_critical]);
    expect(md).toContain("free extraction");
  });
});

// ─────────────────────────────────────────────────────────────
// enrichWithClaude — optional enrichment, skipped when no key
// ─────────────────────────────────────────────────────────────
describe("enrichWithClaude", () => {
  const SAMPLE_REPORT = "# Test Report\n\nSome content.";

  it("returns the original report unchanged when apiKey is undefined", async () => {
    const result = await enrichWithClaude(SAMPLE_REPORT, undefined);
    expect(result).toBe(SAMPLE_REPORT);
  });

  it("returns the original report unchanged when apiKey is empty string", async () => {
    const result = await enrichWithClaude(SAMPLE_REPORT, "");
    expect(result).toBe(SAMPLE_REPORT);
  });

  it("return type is always a string", async () => {
    const result = await enrichWithClaude(SAMPLE_REPORT, undefined);
    expect(typeof result).toBe("string");
  });

  it("the function signature accepts (report, apiKey) and returns Promise<string>", async () => {
    // Verifies the contract: enrichWithClaude is always async and returns a string.
    // The no-op path (undefined key) is the only deterministic path in unit tests;
    // the live Anthropic path is exercised by integration tests or manual CLI runs.
    const result = await enrichWithClaude(SAMPLE_REPORT, undefined);
    expect(typeof result).toBe("string");
  });

  it("no-key path is synchronously fast (no I/O)", async () => {
    const start = Date.now();
    await enrichWithClaude(SAMPLE_REPORT, undefined);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ─────────────────────────────────────────────────────────────
// Dynamic rate warning rendering
// ─────────────────────────────────────────────────────────────
describe("dynamic rate warning in output", () => {
  const DYNAMIC_RATE_PAIR: ScalingPair = {
    swapFunction: "swapGivenOut",
    upscale: { functionName: "mulDown", line: 10, col: 4, context: "upscale", dynamicRate: true },
    downscale: { functionName: "divDown", line: 12, col: 4, context: "downscale" },
    isAsymmetric: true,
    severity: "CRITICAL",
    description: "mulDown + divDown: both round toward zero.",
    taintPath: ["scaledOut"],
  };
  const finding_dynamic: AuditFinding = { file: "DynPool.sol", pairs: [DYNAMIC_RATE_PAIR], rawCalls: [] };

  it("toMarkdown includes DYNAMIC RATE warning for dynamic-rate pairs", () => {
    const md = toMarkdown([finding_dynamic]);
    expect(md).toMatch(/DYNAMIC RATE/i);
    expect(md).toMatch(/runtime/i);
    expect(md).toMatch(/fuzzing/i);
  });

  it("toMarkdown includes taintPath variable name when present", () => {
    const md = toMarkdown([finding_dynamic]);
    expect(md).toMatch(/scaledOut/);
  });

  it("toJson includes dynamicRate: true on upscale in pair", () => {
    const result = toJson([finding_dynamic]) as any;
    const pair = result.findings[0].pairs[0];
    expect(pair.upscale.dynamicRate).toBe(true);
  });
});
