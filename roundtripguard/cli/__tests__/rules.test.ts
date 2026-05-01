import { isSwapFunction, evaluatePair } from "../rules";

// ─────────────────────────────────────────────────────────────
// isSwapFunction — heuristic recognises swap execution paths
// ─────────────────────────────────────────────────────────────
describe("isSwapFunction", () => {
  test.each([
    ["swapGivenOut",   true],
    ["swapGivenIn",    true],
    ["_swapGivenOut",  true],  // private underscore-prefixed variant
    ["onSwap",         true],
    ["onswap",         true],  // lowercase
    ["SWAPGIVENOUT",   true],  // all-caps — case-insensitive
    ["exchange",       true],
    ["exchangeTokens", true],
    ["calcOutGivenIn", true],  // contains "calcout"
    ["calcInGivenOut", true],  // contains "calcin"
    ["givenInSwap",    true],
    ["givenOutSwap",   true],
  ])("%s → true", (name, expected) => {
    expect(isSwapFunction(name)).toBe(expected);
  });

  test.each([
    ["deposit",        false],
    ["withdraw",       false],
    ["_upscale",       false],
    ["_downscaleUp",   false],
    ["mulDown",        false],
    ["divUp",          false],
    ["transfer",       false],
    ["addLiquidity",   false],
    ["",               false],
  ])("%s → false", (name, expected) => {
    expect(isSwapFunction(name)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────
// evaluatePair — classifies upscale / downscale rounding pairs
// ─────────────────────────────────────────────────────────────
describe("evaluatePair", () => {
  // THE BUG: both rounds toward zero — net bias toward attacker
  describe("mulDown + divDown (the Balancer exploit pattern)", () => {
    it("is CRITICAL regardless of swap context", () => {
      const result = evaluatePair("mulDown", "divDown");
      expect(result.severity).toBe("CRITICAL");
      expect(result.isAsymmetric).toBe(true);
    });

    it("is still CRITICAL when explicitly in swap context", () => {
      const result = evaluatePair("mulDown", "divDown", true);
      expect(result.severity).toBe("CRITICAL");
    });

    it("description mentions free extraction", () => {
      const { description } = evaluatePair("mulDown", "divDown");
      expect(description).toMatch(/amountIn = 0/);
      expect(description).toMatch(/free extraction/i);
    });

    it("description mentions drain mechanism", () => {
      const { description } = evaluatePair("mulDown", "divDown");
      expect(description).toMatch(/micro-swap/i);
    });
  });

  // BOTH-UP: biases against caller — benign outside swap, warning inside swap
  describe("mulUp + divUp (double-ceiling)", () => {
    it("is OK outside swap context", () => {
      const result = evaluatePair("mulUp", "divUp", false);
      expect(result.severity).toBe("OK");
      expect(result.isAsymmetric).toBe(true);
    });

    it("is WARNING inside swap context", () => {
      const result = evaluatePair("mulUp", "divUp", true);
      expect(result.severity).toBe("WARNING");
      expect(result.isAsymmetric).toBe(true);
    });

    it("defaults to outside-swap when no third arg", () => {
      const result = evaluatePair("mulUp", "divUp");
      expect(result.severity).toBe("OK");
    });

    it("description mentions protocol bias", () => {
      const { description } = evaluatePair("mulUp", "divUp");
      expect(description).toMatch(/protocol/i);
    });
  });

  // SAFE pairs: opposite directions cancel
  describe("asymmetric-safe pairs (opposite rounding)", () => {
    it("mulDown + divUp → OK, not asymmetric", () => {
      const result = evaluatePair("mulDown", "divUp");
      expect(result.severity).toBe("OK");
      expect(result.isAsymmetric).toBe(false);
    });

    it("mulUp + divDown → OK, not asymmetric", () => {
      const result = evaluatePair("mulUp", "divDown");
      expect(result.severity).toBe("OK");
      expect(result.isAsymmetric).toBe(false);
    });

    it("mulDown + divUp description mentions cancel", () => {
      const { description } = evaluatePair("mulDown", "divUp");
      expect(description).toMatch(/cancel/i);
    });

    it("mulUp + divDown description mentions cancel", () => {
      const { description } = evaluatePair("mulUp", "divDown");
      expect(description).toMatch(/cancel/i);
    });
  });

  // Edge: unexpected function names fall through to default
  describe("unknown / unrecognised function names", () => {
    it("unknown pair → OK, not asymmetric", () => {
      const result = evaluatePair("mulSomething", "divOther");
      expect(result.severity).toBe("OK");
      expect(result.isAsymmetric).toBe(false);
    });

    it("empty strings → OK", () => {
      const result = evaluatePair("", "");
      expect(result.severity).toBe("OK");
    });
  });

  // Description is always a non-empty string
  describe("all pairs return a non-empty description", () => {
    // Explicit undefined avoids Jest misreading a missing 3rd element as the done() callback
    const pairs: [string, string, boolean | undefined][] = [
      ["mulDown", "divDown", undefined],
      ["mulDown", "divDown", true],
      ["mulUp",   "divUp",   undefined],
      ["mulUp",   "divUp",   true],
      ["mulDown", "divUp",   undefined],
      ["mulUp",   "divDown", undefined],
    ];

    test.each(pairs)("evaluatePair(%s, %s, %s) has description", (u, d, ctx) => {
      const result = evaluatePair(u, d, ctx ?? false);
      expect(typeof result.description).toBe("string");
      expect(result.description.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────
// isSwapFunction — configurable patterns
// ─────────────────────────────────────────────────────────────
describe("isSwapFunction with custom patterns", () => {
  it("matches a custom pattern not in defaults", () => {
    expect(isSwapFunction("computeOutput", ["computeoutput"])).toBe(true);
  });

  it("does not match default patterns when custom list overrides", () => {
    // "swap" is in defaults but not in the custom list
    expect(isSwapFunction("swapGivenOut", ["computeoutput"])).toBe(false);
  });

  it("empty custom patterns list matches nothing", () => {
    expect(isSwapFunction("swapGivenOut", [])).toBe(false);
  });

  it("custom pattern is case-insensitive (lowercased internally)", () => {
    expect(isSwapFunction("ComputeOutput", ["computeoutput"])).toBe(true);
  });

  it("no patterns arg → uses defaults (backward-compatible)", () => {
    expect(isSwapFunction("swapGivenOut")).toBe(true);
    expect(isSwapFunction("deposit")).toBe(false);
  });
});
