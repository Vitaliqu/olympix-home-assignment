import { walkSource } from "../ast-walker";

// ─────────────────────────────────────────────────────────────
// Minimal Solidity snippets used across tests
// ─────────────────────────────────────────────────────────────

// Exactly mirrors MockVulnerablePool._swapGivenOut:
//   mulDown (upscale amountOut) → math → divDown (downscale result)
const VULN_SOURCE = `
pragma solidity ^0.8.0;
library FixedPoint {
    uint256 constant ONE = 1e18;
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / ONE; }
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * ONE) / b; }
}
contract VulnPool {
    using FixedPoint for uint256;
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        uint256 scaledOut = amountOut.mulDown(1e12);
        uint256 scaledIn  = scaledOut * 8 / 8;
        amountIn = scaledIn.divDown(1e12);
    }
}
`;

// Fix: mulDown → mulUp in upscale, plain ceiling in downscale
const FIXED_SOURCE = `
pragma solidity ^0.8.0;
library FixedPoint {
    uint256 constant ONE = 1e18;
    function mulUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 p = a * b; return p == 0 ? 0 : (p - 1) / ONE + 1;
    }
    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 ai = a * ONE; return ai == 0 ? 0 : (ai - 1) / b + 1;
    }
}
contract FixedPool {
    using FixedPoint for uint256;
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        uint256 scaledOut = amountOut.mulUp(1e12);
        amountIn = scaledOut.divUp(1e12);
    }
}
`;

// Safe pair: mulDown upscale + divUp downscale — rounding biases cancel
const SAFE_PAIR_SOURCE = `
pragma solidity ^0.8.0;
library FP {
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / 1e18; }
    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 ai = a * 1e18; return ai == 0 ? 0 : (ai - 1) / b + 1;
    }
}
contract SafePool {
    using FP for uint256;
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        uint256 scaled = amountOut.mulDown(1e12);
        amountIn = scaled.divUp(1e12);
    }
}
`;

// Two swap functions — each has its own bug
const TWO_FN_SOURCE = `
pragma solidity ^0.8.0;
library FP {
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / 1e18; }
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * 1e18) / b; }
    function mulUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 p = a * b; return p == 0 ? 0 : (p - 1) / 1e18 + 1;
    }
    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 ai = a * 1e18; return ai == 0 ? 0 : (ai - 1) / b + 1;
    }
}
contract TwoSwaps {
    using FP for uint256;
    function swapGivenOut(uint256 a) external returns (uint256) {
        uint256 scaled = a.mulDown(1e12);
        return scaled.divDown(1e12);
    }
    function exchangeTokens(uint256 a) external returns (uint256) {
        uint256 scaled = a.mulDown(1e6);
        return scaled.divDown(1e6);
    }
}
`;

// Non-swap function that contains mulDown/divDown — should NOT appear
const NON_SWAP_SOURCE = `
pragma solidity ^0.8.0;
library FP {
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / 1e18; }
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * 1e18) / b; }
}
contract Fees {
    using FP for uint256;
    function calculateFee(uint256 amount) external pure returns (uint256) {
        uint256 scaled = amount.mulDown(1e12);
        return scaled.divDown(1e12);
    }
}
`;

// Source with a WARNING: mulUp/divUp inside swap context
const WARNING_SOURCE = `
pragma solidity ^0.8.0;
library FP {
    function mulUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 p = a * b; return p == 0 ? 0 : (p - 1) / 1e18 + 1;
    }
    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 ai = a * 1e18; return ai == 0 ? 0 : (ai - 1) / b + 1;
    }
}
contract WarnPool {
    using FP for uint256;
    function onSwap(uint256 a) external returns (uint256) {
        uint256 scaled = a.mulUp(1e12);
        return scaled.divUp(1e12);
    }
}
`;

// ─────────────────────────────────────────────────────────────
// walkSource tests
// ─────────────────────────────────────────────────────────────
describe("walkSource", () => {
  // ── file metadata ────────────────────────────────────────────
  it("returns the passed fileName in result.file", () => {
    const result = walkSource("MyPool.sol", VULN_SOURCE);
    expect(result.file).toBe("MyPool.sol");
  });

  // ── empty / trivial inputs ───────────────────────────────────
  it("returns empty arrays for empty source", () => {
    const result = walkSource("empty.sol", "");
    expect(result.pairs).toHaveLength(0);
    expect(result.rawCalls).toHaveLength(0);
  });

  it("does not throw on invalid Solidity (tolerant parser)", () => {
    expect(() => walkSource("bad.sol", "this is not solidity @@@")).not.toThrow();
    const result = walkSource("bad.sol", "this is not solidity @@@");
    expect(result.pairs).toHaveLength(0);
  });

  // ── vulnerable pattern ───────────────────────────────────────
  describe("VULN_SOURCE — mulDown/divDown in swapGivenOut", () => {
    let result: ReturnType<typeof walkSource>;
    beforeAll(() => { result = walkSource("VulnPool.sol", VULN_SOURCE); });

    it("detects exactly 1 pair", () => {
      expect(result.pairs).toHaveLength(1);
    });

    it("pair is CRITICAL severity", () => {
      expect(result.pairs[0].severity).toBe("CRITICAL");
    });

    it("pair upscale is mulDown", () => {
      expect(result.pairs[0].upscale.functionName).toBe("mulDown");
    });

    it("pair downscale is divDown", () => {
      expect(result.pairs[0].downscale.functionName).toBe("divDown");
    });

    it("pair is in swapGivenOut function", () => {
      expect(result.pairs[0].swapFunction).toBe("swapGivenOut");
    });

    it("pair is asymmetric", () => {
      expect(result.pairs[0].isAsymmetric).toBe(true);
    });

    it("rawCalls contains both mulDown and divDown", () => {
      const names = result.rawCalls.map((c) => c.functionName);
      expect(names).toContain("mulDown");
      expect(names).toContain("divDown");
    });

    it("upscale has a valid line number", () => {
      expect(result.pairs[0].upscale.line).toBeGreaterThan(0);
    });

    it("downscale line is >= upscale line (source order preserved)", () => {
      const { upscale, downscale } = result.pairs[0];
      expect(downscale.line).toBeGreaterThanOrEqual(upscale.line);
    });
  });

  // ── fixed pattern ────────────────────────────────────────────
  describe("FIXED_SOURCE — mulUp/divUp in non-swap-keyword fn", () => {
    it("produces 0 CRITICAL pairs", () => {
      const result = walkSource("FixedPool.sol", FIXED_SOURCE);
      const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
      expect(critical).toHaveLength(0);
    });

    // mulUp/divUp in a function named "swapGivenOut" → WARNING (swap context)
    it("produces a WARNING for mulUp/divUp inside swap function", () => {
      const result = walkSource("FixedPool.sol", FIXED_SOURCE);
      const warnings = result.pairs.filter((p) => p.severity === "WARNING");
      expect(warnings).toHaveLength(1);
    });
  });

  // ── safe pair is filtered out ────────────────────────────────
  describe("SAFE_PAIR_SOURCE — mulDown/divUp (opposite directions cancel)", () => {
    it("produces 0 pairs (OK severity filtered)", () => {
      const result = walkSource("SafePool.sol", SAFE_PAIR_SOURCE);
      expect(result.pairs).toHaveLength(0);
    });
  });

  // ── non-swap function ────────────────────────────────────────
  // The walker is conservative: mulDown/divDown is ALWAYS CRITICAL regardless of
  // function name — the exploit pattern is dangerous anywhere, and swap-context is
  // only used to escalate mulUp/divUp from OK → WARNING.
  describe("NON_SWAP_SOURCE — mulDown/divDown outside swap path", () => {
    it("still produces 1 CRITICAL pair (exploit pattern flagged unconditionally)", () => {
      const result = walkSource("Fees.sol", NON_SWAP_SOURCE);
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0].severity).toBe("CRITICAL");
    });

    it("rawCalls captures both mul and div calls", () => {
      const result = walkSource("Fees.sol", NON_SWAP_SOURCE);
      expect(result.rawCalls.length).toBeGreaterThan(0);
    });
  });

  // ── two swap functions ───────────────────────────────────────
  describe("TWO_FN_SOURCE — two independent swap functions each with mulDown/divDown", () => {
    let result: ReturnType<typeof walkSource>;
    beforeAll(() => { result = walkSource("TwoSwaps.sol", TWO_FN_SOURCE); });

    it("detects 2 CRITICAL pairs (one per swap function)", () => {
      const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
      expect(critical).toHaveLength(2);
    });

    it("pairs belong to different swap functions", () => {
      const fns = result.pairs.map((p) => p.swapFunction);
      expect(fns).toContain("swapGivenOut");
      expect(fns).toContain("exchangeTokens");
    });
  });

  // ── WARNING case ─────────────────────────────────────────────
  describe("WARNING_SOURCE — mulUp/divUp inside onSwap (swap context)", () => {
    let result: ReturnType<typeof walkSource>;
    beforeAll(() => { result = walkSource("WarnPool.sol", WARNING_SOURCE); });

    it("produces exactly 1 WARNING", () => {
      const warnings = result.pairs.filter((p) => p.severity === "WARNING");
      expect(warnings).toHaveLength(1);
    });

    it("no CRITICAL findings", () => {
      const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
      expect(critical).toHaveLength(0);
    });

    it("pair is in onSwap", () => {
      expect(result.pairs[0].swapFunction).toBe("onSwap");
    });
  });

  // ── rawCalls shape ───────────────────────────────────────────
  describe("rawCalls metadata", () => {
    it("each rawCall has functionName, line, col, callType, roundingDir", () => {
      const result = walkSource("VulnPool.sol", VULN_SOURCE);
      for (const call of result.rawCalls) {
        expect(typeof call.functionName).toBe("string");
        expect(typeof call.line).toBe("number");
        expect(typeof call.col).toBe("number");
        expect(["mul", "div"]).toContain(call.callType);
        expect(["down", "up"]).toContain(call.roundingDir);
      }
    });

    it("mulDown calls have callType=mul and roundingDir=down", () => {
      const result = walkSource("VulnPool.sol", VULN_SOURCE);
      const mulDownCalls = result.rawCalls.filter((c) => c.functionName === "mulDown");
      for (const c of mulDownCalls) {
        expect(c.callType).toBe("mul");
        expect(c.roundingDir).toBe("down");
      }
    });

    it("divDown calls have callType=div and roundingDir=down", () => {
      const result = walkSource("VulnPool.sol", VULN_SOURCE);
      const divDownCalls = result.rawCalls.filter((c) => c.functionName === "divDown");
      for (const c of divDownCalls) {
        expect(c.callType).toBe("div");
        expect(c.roundingDir).toBe("down");
      }
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Taint tracking — variable assignment path
// ─────────────────────────────────────────────────────────────

const TAINT_VAR_SOURCE = `
pragma solidity ^0.8.0;
library FP {
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / 1e18; }
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * 1e18) / b; }
}
contract TaintPool {
    using FP for uint256;
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        uint256 scaledOut = amountOut.mulDown(1e12);
        uint256 intermediate = scaledOut * 2 / 2;
        amountIn = intermediate.divDown(1e12);
    }
}
`;

const TAINT_CLEARED_SOURCE = `
pragma solidity ^0.8.0;
library FP {
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / 1e18; }
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * 1e18) / b; }
    function mulUp(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b + 1e18 - 1) / 1e18; }
}
contract TaintCleared {
    using FP for uint256;
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        uint256 scaledOut = amountOut.mulDown(1e12);
        scaledOut = amountOut.mulUp(1e12);
        amountIn = scaledOut.divDown(1e12);
    }
}
`;

describe("taint tracking", () => {
  it("detects mulDown→variable→divDown as CRITICAL pair", () => {
    const result = walkSource("TaintPool.sol", TAINT_VAR_SOURCE);
    const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
    expect(critical).toHaveLength(1);
    expect(critical[0].upscale.functionName).toBe("mulDown");
    expect(critical[0].downscale.functionName).toBe("divDown");
  });

  it("taint-tracked pair has taintPath containing the intermediate variable name", () => {
    const result = walkSource("TaintPool.sol", TAINT_VAR_SOURCE);
    const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
    expect(critical[0].taintPath).toBeDefined();
    expect(critical[0].taintPath!.length).toBeGreaterThan(0);
    expect(critical[0].taintPath).toContain("scaledOut");
  });

  it("clears taint on reassignment with non-dangerous fn — mulUp/divDown pair is OK (not CRITICAL)", () => {
    const result = walkSource("TaintCleared.sol", TAINT_CLEARED_SOURCE);
    const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
    expect(critical).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Dynamic rate detection
// ─────────────────────────────────────────────────────────────

const DYNAMIC_RATE_SOURCE = `
pragma solidity ^0.8.0;
interface IRateProvider { function getRate() external view returns (uint256); }
library FP {
    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * b) / 1e18; }
    function divDown(uint256 a, uint256 b) internal pure returns (uint256) { return (a * 1e18) / b; }
}
contract DynPool {
    using FP for uint256;
    IRateProvider rp;
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        uint256 scaledOut = amountOut.mulDown(rp.getRate());
        amountIn = scaledOut.divDown(rp.getRate());
    }
}
`;

describe("dynamic rate detection", () => {
  it("detects mulDown with getRate() arg as dynamicRate=true", () => {
    const result = walkSource("DynPool.sol", DYNAMIC_RATE_SOURCE);
    const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
    expect(critical).toHaveLength(1);
    expect(critical[0].upscale.dynamicRate).toBe(true);
  });

  it("custom dynamicRateFunctions option is respected", () => {
    const result = walkSource("DynPool.sol", DYNAMIC_RATE_SOURCE, {
      dynamicRateFunctions: ["customRateFn"],
    });
    const critical = result.pairs.filter((p) => p.severity === "CRITICAL");
    expect(critical[0].upscale.dynamicRate).toBeFalsy();
  });
});
