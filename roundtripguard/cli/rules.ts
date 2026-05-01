export interface RoundingCall {
  functionName: string;
  line: number;
  col: number;
  context: "upscale" | "downscale" | "unknown";
  dynamicRate?: boolean;
}

export interface ScalingPair {
  swapFunction: string;
  upscale: RoundingCall;
  downscale: RoundingCall;
  isAsymmetric: boolean;
  severity: "CRITICAL" | "WARNING" | "OK";
  description: string;
  taintPath?: string[];   // variable names traversed between upscale and downscale calls
}

/** Built-in swap-function keyword list — used when no custom patterns are provided. */
export const DEFAULT_SWAP_PATTERNS: string[] = [
  "swap",
  "exchange",
  "givenin",
  "givenout",
  "onswap",
  "calcin",
  "calcout",
];

/**
 * Heuristic: is this function name part of a swap execution path?
 * @param name     Function name to test.
 * @param patterns Optional override list of lowercase substrings. Uses DEFAULT_SWAP_PATTERNS when omitted.
 */
export function isSwapFunction(name: string, patterns?: string[]): boolean {
  const lower = name.toLowerCase();
  const list = patterns ?? DEFAULT_SWAP_PATTERNS;
  return list.some((p) => lower.includes(p));
}

/**
 * Classify a sequential (upscale → downscale) rounding pair.
 *
 * The Balancer V2 bug:
 *   mulDown (upscale) + divDown (downscale) — both bias toward the caller.
 *   At sub-1e6 token balances, the upscaled amountOut rounds to 0, so
 *   scaledIn = 0 and amountIn = 0. The caller extracts value for free.
 *
 * @param inSwapContext  true when the enclosing function is part of a swap path.
 *   Elevates WARNING → CRITICAL for double-down pairs in swap contexts.
 */
export function evaluatePair(
  upscaleFn: string,
  downscaleFn: string,
  inSwapContext = false
): {
  isAsymmetric: boolean;
  severity: "CRITICAL" | "WARNING" | "OK";
  description: string;
} {
  if (upscaleFn === "mulDown" && downscaleFn === "divDown") {
    return {
      isAsymmetric: true,
      severity: "CRITICAL",
      description:
        "mulDown (upscale) + divDown (downscale): both round toward zero. " +
        "Net bias ~1 wei per swap favours the caller. " +
        "At balance < 1e6 / SCALING_FACTOR wei, upscaled amountOut rounds to 0 " +
        "→ scaledIn = 0 → amountIn = 0 (free extraction). " +
        "Pool fully drained in O(reserve) micro-swaps.",
    };
  }

  if (upscaleFn === "mulUp" && downscaleFn === "divUp") {
    return {
      isAsymmetric: true,
      severity: inSwapContext ? "WARNING" : "OK",
      description:
        "mulUp (upscale) + divUp (downscale): both round away from zero. " +
        "Bias favours the protocol, but may reject valid swaps at extreme precision. " +
        "Benign in most contexts; verify swap path does not over-charge callers.",
    };
  }

  if (
    (upscaleFn === "mulDown" && downscaleFn === "divUp") ||
    (upscaleFn === "mulUp" && downscaleFn === "divDown")
  ) {
    return {
      isAsymmetric: false,
      severity: "OK",
      description: `${upscaleFn}/${downscaleFn}: opposite rounding directions cancel — safe.`,
    };
  }

  return {
    isAsymmetric: false,
    severity: "OK",
    description: `${upscaleFn}/${downscaleFn}: no asymmetric rounding detected.`,
  };
}
