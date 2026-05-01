# RoundTripGuard

> **A DeFi security toolkit for detecting and preventing compositional invariant violations in rate-augmented AMMs.**
>
> Built around the Balancer V2 ComposableStablePool exploit (November 2025, ~$120–128M) — the most technically sophisticated arithmetic vulnerability to hit DeFi in the last three years, and the one that four separate audits missed entirely.

---

## Executive Summary

Most DeFi exploits break something that is obviously wrong. The Balancer V2 rounding bug broke nothing. Every function in the attack pipeline was arithmetically correct. The pool's invariant math was correct. The fixed-point library had been audited three times. The catastrophe emerged from the *composition* of individually correct operations — a class of failure that existing security tooling is not designed to catch.

RoundTripGuard answers a question that no standard audit scope asks: **"Does a sequence of N calls to this function preserve the protocol's economic invariant end-to-end?"** It implements three complementary layers — a stateful invariant fuzzer, an AST-based static analyzer, and an optional on-chain circuit breaker — each targeting the same core failure from a different angle.

The architecture is designed to be **generalizable beyond rounding**: the compositional invariant verification principle applies to any protocol where the safety property is a relationship across multiple sequential calls, not just a property of any single call.

---

## DeFi Exploits Research — Last 18 Months

Before focusing on Balancer, I surveyed the major DeFi incidents from October 2024 through April 2026. Full write-ups are in [`docs/exploits-overview.md`](docs/exploits-overview.md).

| Exploit | Date | Loss | Root Cause | Key Lesson |
|---------|------|------|------------|------------|
| Bybit Hot Wallet | Feb 2025 | ~$1.46B | Supply chain / front-end injection | Signing security includes the UI that constructs transactions |
| Radiant Capital | Oct 2024 | ~$52M | Targeted device malware | Hardware wallets don't protect against host-level compromise |
| Penpie | Sep 2024 | ~$27M | Cross-protocol reentrancy | Permissionless factory integrations require untrusted-call semantics |
| UwU Lend | Jun 2024 | ~$19.3M | Oracle manipulation (flash loan) | Spot price oracles in thin markets are trivially manipulable |
| Hedgey Finance | Apr 2024 | ~$44.7M | Missing input validation / arbitrary call | User-supplied contract addresses must never receive privileged calls |
| **Balancer V2** | **Nov 2025** | **~$120–128M** | **Compositional rounding arithmetic** | **Local correctness ≠ compositional safety** |

The first five exploits belong to categories the industry already understands. We have checklist items for reentrancy, oracle manipulation, input validation, and key management. The Balancer exploit is different: it represents a class of failure for which **no standard tooling, audit checklist item, or prevention practice existed**. Four competent audits over three years all missed it, because none were scoped to ask whether sequential operations preserved value end-to-end.

That gap is what RoundTripGuard addresses.

---

## Why I Chose the Balancer V2 Exploit

*What follows is my honest account of why this bug stood out.*

The Bybit hack is larger in dollar terms and politically significant — a billion-dollar theft attributed to a nation-state actor. The Radiant Capital hack is a masterclass in targeted supply chain compromise. Any of these would make for a compelling case study. I chose Balancer because it is the only one that forces a fundamental rethink of how we reason about correctness in DeFi protocols.

The core insight that keeps drawing me back to this exploit is what I'd call the **epistemological failure**: we convinced ourselves that verified-correct components compose into a verified-correct system. That assumption is false, and this bug is the proof.

Consider what four audit teams confirmed over three years: `mulDown` is arithmetically correct. `StableMath._calcInGivenOut` correctly solves the invariant equation. `divDown` correctly divides. Every function passes its unit tests. The formal specification verifies single-swap invariant preservation. No individual statement in the codebase is wrong. And yet, the composition of `mulDown(1, 1e12) → StableMath(0) → divDown(0)` lets an attacker drain the pool entirely, at zero cost, in a single block. The system is simultaneously locally correct and globally catastrophic.

What makes this particularly troubling is that the failure mode is *not exotic*. It doesn't require a flash loan, a governance attack, or a compromised key. It requires only: (a) positioning a reserve below a threshold that the attacker computed off-chain, and (b) calling a public function with a small integer argument, repeated 65 times in one batch transaction. The sophistication is entirely in recognizing that the threshold exists. Once you understand `mulDown(a, b) = 0` when `a × b < 1e18`, the rest follows mechanically.

The deeper implication is about **the limits of current security tooling**. Formal verification, as applied in DeFi today, is excellent at proving invariants about single transactions. Certora can verify that a single swap preserves the pool invariant. What it cannot easily express is: "for any sequence of swaps, does the protocol collect at least as much value as it dispenses?" That is a *temporal* or *sequential* property, and it requires a different kind of tool — stateful fuzzing, property-based testing with ghost variables, or explicit sequential invariant specifications.

This is also a window into the **systemic risk of rate-augmented AMMs more broadly**. As more yield-bearing tokens (wstETH, rETH, cbETH, weETH) become DeFi primitives, more protocols will compose rate-scaled fixed-point arithmetic in their core pricing paths. Each such protocol inherits this entire class of vulnerability if it chooses `mulDown` where `mulUp` is semantically required. The Balancer bug is not a one-off; it is a symptom of a design pattern that the industry adopted widely without fully understanding its properties.

Finally, the fix is a single-word change — `mulDown` to `mulUp` at one call site. The fix takes less time to implement than it took to read any one of the four audit reports that missed the bug. That disproportion between fix complexity and discovery complexity is, to me, the most important fact about this entire incident. It means that better tooling — not more auditing — is the correct investment.

That is the thesis behind RoundTripGuard.

---

## Architecture

### Two Primary Tools, One Optional Backstop

For any protocol that controls its own deployment, two tools are sufficient.

**Tool 1 — Stateful Invariant Fuzzer** (`test/RoundTripInvariantTest.t.sol`)

Ghost variables `ghost_totalIn` and `ghost_totalOut` accumulate value across an entire fuzz sequence. The invariant `ghost_totalOut ≤ ghost_totalIn` trips the moment any swap extracts value at zero cost. Run with reserves initialized at `ceil(1e18 / scalingFactor) + 1` — the exact threshold where truncation becomes possible.

**Tool 2 — AST Rounding Classifier** (`cli/scaling-audit.ts`)

Parses Solidity source to an AST and flags `mulDown → divDown` pairs inside swap functions as CRITICAL. Exits with code 1, blocking the PR. No Foundry, no Anvil, no environment — runs in under 5 seconds on any CI runner.

**Tool 3 — On-Chain Circuit Breaker** (`src/InvariantMonitor.sol` + `src/EmergencyPauser.sol`) — optional

For protocols that are *already deployed* and cannot redeploy without a governance process. Permissionless monitoring emits `CircuitBreakerTripped`; a separate authorized `EmergencyPauser` holds `pause()` — this separation prevents a malicious monitor from triggering false pauses. Add this only for pools with TVL > $10M; below that, the gas overhead and false-pause risk outweigh the benefit.

### What Was Cut and Why

**Off-chain WebSocket scanner** was removed from the project entirely for three reasons:

1. **Redundant signal.** It detects the same invariant drift as `InvariantMonitor` on-chain. Two detectors with identical signal add operational complexity, not safety.
2. **Cannot influence atomic transactions.** The real Balancer attack completes all 65 swaps in one `batchSwap`. By the time a WebSocket event fires and an alert routes to an engineer, the transaction is finalized. Off-chain monitoring is structurally too slow to prevent this class of attack.
3. **Operational cost with no unique upside.** Running a live WebSocket subscriber, routing alerts, and maintaining on-call coverage costs real engineering time. If you already have Tool 3 with a keeper wired, a scanner duplicates that coverage without adding it.

### Why Two Tools Are Sufficient

This class of bug has two necessary conditions that must both hold:

1. **A `mulDown → divDown` sequence exists in a swap function.** Tool 2 catches this statically on every PR.
2. **Pool reserves can be driven below `ceil(1e18 / scalingFactor)`.** Tool 1 catches this dynamically — any `amountIn = 0` at sub-threshold reserves trips the ghost variable invariant on the first fuzz call.

If condition (1) is absent, the truncation-to-zero composition cannot exist in the codebase. If condition (1) is present, condition (2) is mechanically testable. Both conditions must hold for the exploit to work; Tool 2 blocks (1) in CI, Tool 1 finds (2) before deployment. Together they cover the full attack surface of this bug class.

The remaining gap: rounding compositions that span function boundaries — where `mulDown` in one function passes its result to a separate function containing `divDown`. Tool 2's taint tracking is intra-function only; cross-file data flow is not traced. Tool 1 now sweeps six scaling factor rates (`RoundTripRateSweepTest`) and tests cross-pool sequential drains (`MultiPoolInvariantTest`), closing the rate-sweep gap. Both remaining limitations are documented in Limitations.

---

## Why Not Just Fix the Math?

The fix is a single word: `mulDown` → `mulUp` at line 64 of `MockVulnerablePool.sol`. If the fix is that simple, why build tooling around it?

**Finding the bug is the hard part.** Four competent audit teams over three years reviewed this code and did not flag that line. Not because they were careless — because the rounding direction at an individual call site is only wrong *in context*: when you know this is the upscale step of a GIVEN_OUT swap, that the result feeds into a zero-check in StableMath, and that the net effect at sub-threshold reserves is zero amortization cost per swap. None of that is visible from `mulDown(amountOut, SCALING_FACTOR)` in isolation.

**Protocols are not static.** Balancer V2 has been deployed with 47 pool variants, multiple rate provider configurations, and an upgrade history spanning three years. Every new pool type and every `_upscale` override is a fresh opportunity to reintroduce the same class of bug. A one-time fix does not prevent regression. A CI gate does.

**The pattern generalizes.** `mulDown → divDown` in a fixed-point pricing path appears in Curve, Uniswap V3 price computations, Aave interest rate accrual, and Compound exchange rates. This is not a Balancer-specific bug; it is a class of error that any fixed-point AMM can introduce during development.

### How RoundTripGuard Compares to Existing Tools

| Tool | Checks compositional sequences | Detects rounding direction | CI-ready | Cost |
|------|-------------------------------|---------------------------|----------|------|
| Slither | No | No | Yes (fast) | Free |
| Mythril | Partial (bounded) | No | Slow (~hours) | Free |
| Echidna | Yes (stateful) | Requires custom invariant | Yes | Free |
| Certora Prover | Single-transaction only | Yes, if specified | Yes | $$$ |
| Manual audit | Depends on scope | Sometimes | No | $$$$ |
| **RoundTripGuard L1** | **Yes** | **Ghost-variable invariants** | **Yes** | **Free** |
| **RoundTripGuard L2** | **N/A (syntactic)** | **Yes, no invariant needed** | **Yes (<5s)** | **Free** |

**Where Echidna leaves a gap:** Echidna would catch this bug with the right invariant. `ghost_totalOut <= ghost_totalIn` is not a default invariant — you need to know to write it. Layer 1b provides this invariant as a starting point. Layer 2 surfaces the syntactic precondition without requiring the user to already suspect a rounding problem.

**Where Certora left a gap:** Certora's proof held — single-swap invariant preservation is true. The missing specification was `∀ sequence of swaps: Σ(amountIn) ≥ Σ(amountOut)`. Sequential value conservation over unbounded call sequences falls outside standard Certora spec patterns for DeFi at the time of the audits.

---

## Integration in Real Protocols

### Layer 2 in CI — Static Analysis (Day 0)

Add to your security workflow:

```yaml
# .github/workflows/security.yml
- name: Rounding audit
  run: npx ts-node cli/scaling-audit.ts --file src/
  # exits 1 on CRITICAL findings, blocks merge
```

Under 5 seconds, no Foundry, no environment setup. Every PR that touches AMM pricing code is automatically checked. A false positive (a non-swap function matching the heuristic) requires a one-line suppression comment to dismiss.

**Who sets this up:** DevOps or security engineer, once.  
**When it fires:** On every PR that modifies any `.sol` file.  
**Signal:** Exit code 1 + CRITICAL report blocks the merge.

### Layer 1 Pre-Deploy — Stateful Fuzzer (Before Mainnet)

Run as part of the pre-deploy security checklist, after code review and before deployment. The fuzzer must be initialized at sub-normal reserves to trigger the truncation boundary. For a pool with `scalingFactor = X`, the truncation threshold is `ceil(1e18 / X)` — start reserves at `threshold + 1`.

```bash
forge test --match-contract RoundTripInvariantTest --fuzz-runs 10000
```

**Who runs this:** Security reviewer (internal or external). One-time per pool type.  
**When:** Post-code-freeze, pre-deployment.  
**Signal:** Any `FAIL` with a non-zero ghost variable is a blocking finding.

### Layer 3 Post-Deploy — Circuit Breaker (High-TVL Pools Only)

Deploy `InvariantMonitor` + `EmergencyPauser` for pools with TVL > $10M that cannot be paused and redeployed without a governance process. Below that threshold, the cost of a false positive pause (liquidity disruption, keeper gas, reputational cost) can exceed the expected value protected.

**Who deploys this:** Protocol security team.  
**When:** Alongside the pool, active from day 1 of liquidity.  
**Signal:** `CircuitBreakerTripped` event → keeper calls `EmergencyPauser.pause(poolId)` → protocol notified within one block.

The keeper should be backed by a decentralized automation service (Chainlink Automation, Gelato). Use `addKeeper(address)` to whitelist multiple EOAs — the `EmergencyPauser` keeper whitelist eliminates the single-point-of-failure risk; see Key Improvements for details.

---

## Proof of Concept

The PoC is in [`roundtripguard/`](roundtripguard/). It contains:

| File | What It Demonstrates |
|------|---------------------|
| `src/MockVulnerablePool.sol` | AMM with the bug: `mulDown` upscale on `amountOut` |
| `src/MockFixedPool.sol` | AMM with the fix: ceiling division, attacker always overpays |
| `src/FixedPoint.sol` | Mirror of Balancer's `FixedPoint.sol` — same algorithms, same names |
| `src/InvariantMonitor.sol` | Permissionless on-chain sentinel — Layer 3 detector |
| `src/EmergencyPauser.sol` | Authorized pause enforcer — Layer 3 enforcer |
| `test/BalancerAttackReplay.t.sol` | Layer 1a: deterministic attack + fix verification |
| `test/RoundTripInvariantTest.t.sol` | Layer 1b: stateful fuzzer, fails on vulnerable pool |
| `test/RoundTripHandler.sol` | Handler with ghost variables for the fuzzer |
| `test/MonitorBlocks.t.sol` | Layer 1c: full detection-to-pause integration test |
| `test/EdgeCases.t.sol` | 54 unit tests for arithmetic, monitor, and pauser edge cases |
| `cli/scaling-audit.ts` | Layer 2: AST-based rounding detector, CI-ready |

A Next.js web demo is in [`demo/`](demo/) — side-by-side animated comparison of the vulnerable vs protected pool.

### Prerequisites

```bash
# Foundry (Solidity compiler + test runner + Anvil local chain)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Node.js 18+ (for CLI tools, Next.js demo)
# https://nodejs.org
```

### Quick Start

```bash
# 1. Build the contracts
cd roundtripguard && forge build

# 2. Layer 1a — Attack PoC (deterministic)
#    Expected: vulnerable pool drained, fixed pool holds
forge test --match-contract BalancerAttackReplay -vvv

# 3. Layer 1b — Stateful invariant fuzzer
#    Expected: FAIL on RoundTripInvariantTest (catches bug on first call)
forge test --match-contract RoundTripInvariantTest -vvv

# 4. Layer 1c — Circuit breaker integration
#    Expected: trips on swap 2, keeper pauses, swap 3 reverts BAL#211
forge test --match-contract MonitorBlocks -vvv

# 5. Layer 2 — Static analysis (no node needed, no Anvil needed)
npx ts-node cli/scaling-audit.ts --file src/MockVulnerablePool.sol   # → CRITICAL, exit 1
npx ts-node cli/scaling-audit.ts --file src/MockFixedPool.sol         # → clean, exit 0

# — or run everything at once from the repo root —
make demo      # full end-to-end demo script
make poc       # Layer 1a only
make fuzz      # Layer 1b only
make audit     # Layer 2 only
```

### Expected Output — Layer 1b Fuzzer

```
[FAIL: FREE_EXTRACTION_DETECTED: 1 zero-cost swap(s) across 1 total: 1 != 0]
  [Sequence]
    swapMicro() — amountIn=0, amountOut=1 (first call catches the bug)

[PASS] invariant_fixedPoolNoProfit() (runs: 500, calls: 10000, reverts: 234)
[PASS] invariant_fixedPoolNoFreeExtraction() (runs: 500, calls: 10000, reverts: 234)
```

### Expected Output — Layer 2 Static Analysis

```
# ScalingAudit v2 Report

## File: src/MockVulnerablePool.sol

🔴 **[CRITICAL]** in `swapGivenOut`
  - Upscale:   `mulDown` (line 64)
  - Downscale: `divDown` (line 71)
  - mulDown (upscale) + divDown (downscale): both round toward zero.
    At balance < 1e6 / SCALING_FACTOR wei, upscaled amountOut rounds to 0
    → scaledIn = 0 → amountIn = 0 (free extraction). Pool drained in O(reserve) steps.

Exit code: 1 (CRITICAL findings)
```

### Live Web Demo (already deployed)

**[Try it live → https://olympix-home-assignment.vercel.app/](https://olympix-home-assignment.vercel.app/)**

The demo runs entirely in the browser and replays the full **65-swap attack sequence** in real time:

- **Left panel** — vulnerable `ComposableStablePool` being drained to zero
- **Right panel** — protected pool with RoundTripGuard (circuit breaker trips on swap #2)

No local setup, no Anvil, no `npm install`. Just open and watch the exploit vs protection side-by-side.


---

## Limitations and Trade-offs

### Layer 2 — Static Analysis (`scaling-audit.ts`)

The analyzer reliably detects `mulDown` → `divDown` patterns inside swap functions using intra-function taint tracking. However, the following limitations remain:

- Cross-file and cross-function data flow analysis is not implemented. Taint propagation is currently limited to a single function body.
- Detection relies on configurable syntactic patterns and may require additional tuning for highly non-standard codebases.

### Layer 1 — Stateful Invariant Fuzzer

The fuzzer effectively identifies zero-cost extractions and round-trip profit violations through ghost variables. It has been extended with rate sweeping and multi-pool support. Its effectiveness still depends on appropriate initial conditions and scaling factor ranges to surface edge-case vulnerabilities.

### Layer 3 — On-Chain Circuit Breaker (`InvariantMonitor`)

This layer is provided as an **optional post-deployment backstop** for already-deployed high-TVL pools. Its key limitations are:

- It cannot prevent atomic attacks executed within a single transaction (such as the original Balancer `batchSwap`). Prevention of this exploit class must occur pre-deployment through Layers 1 and 2.
- The monitor introduces a meaningful gas overhead (approximately 82,000 gas for `checkAfterSwap` on the happy path).

### Gas Costs

In the current implementation, `InvariantMonitor.checkAfterSwap` consumes **~82,000 gas** on average. This represents a material increase in transaction cost for high-frequency pools.

For this reason, Layer 3 is recommended only for pools with significant TVL (>$10M) where the additional security benefit justifies the overhead. For most protocols, the combination of corrected math (Layer 2) and rigorous pre-deployment fuzzing (Layer 1) provides sufficient protection without runtime overhead.
### Integration Friction with Real Balancer Pools

`InvariantMonitor.sol` contains a commented `IBalancerVault` adapter block with the three concrete adaptation steps:

1. Replace `pool.getLastInvariant()` with `vault.getPoolTokens(poolId)`
2. Compute StableSwap invariant D via Newton-Raphson (reference: Balancer's `StableMath.sol:_calculateInvariant`)
3. Normalise each token balance via its rate provider before computing D

Full implementation (Newton-Raphson on-chain, multi-token rate provider reads) remains out of scope to keep the security logic readable in isolation.

### What This Does Not Cover

RoundTripGuard is scoped to compositional arithmetic invariants. It does not catch oracle manipulation, reentrancy, key compromise, missing input validation, or any of the other exploit categories in the research survey above. It is one layer in a broader security stack, not a replacement for it.

---

## Lessons Learned

**1. The question "is this function correct?" is insufficient.**
The right question is "does this function, called N times in sequence, preserve the protocol's economic invariant?" This is a compositional property. It requires compositional tools.

**2. Audit scope is a risk surface.**
When multiple audit teams each declare their scope out-of-bounds for compositional analysis, the composition is never analyzed. Audit scopes must explicitly include multi-call sequences for any function that handles token transfers.

**3. Formal verification proves what you specify, not what you need.**
Certora's proof was correct: it proved single-swap invariant preservation, which holds. The missing specification was sequential value conservation, which does not. Formal tools are only as powerful as the properties given to them.

**4. Rounding direction is a security-critical design decision.**
In a GIVEN_OUT swap pipeline, every rounding direction must be chosen relative to the protocol's liability, not just arithmetic convenience. A comment explaining *why* each rounding direction was chosen would have made the bug visible on the first code review.

**5. Low-liquidity states created by an attacker are still valid operating conditions.**
Any state reachable through legal operations is a valid attack precondition. Protocols should fuzz at extreme parameter values — 1 wei, 2 wei, 8 wei — not just at "realistic" operating ranges.

**6. The fix is always simpler than the discovery.**
`mulDown` → `mulUp`. One word. The asymmetry between fix complexity (trivial) and discovery complexity (required 100 billion simulations by the attacker, 3 years and 4 audits by defenders) is the argument for investing in better tooling, not more review time.

---

## Further Reading

- [`docs/balancer-exploit-deep-dive.md`](docs/balancer-exploit-deep-dive.md) — 1,100-line technical reference: full glossary, exploit mechanics, file-by-file code walkthrough, attack/defense comparison
- [`docs/exploits-overview.md`](docs/exploits-overview.md) — Detailed write-ups of all six exploits in the research survey
- [`roundtripguard/`](roundtripguard/) — All source code, tests, CLI, and monitor

---

## Repository Structure

```
.
├── roundtripguard/               # Core security toolkit
│   ├── src/
│   │   ├── FixedPoint.sol        # Fixed-point math library (mirrors Balancer)
│   │   ├── MockVulnerablePool.sol # Pool with the rounding bug
│   │   ├── MockFixedPool.sol     # Pool with the fix
│   │   ├── InvariantMonitor.sol  # Layer 3: on-chain sentinel
│   │   └── EmergencyPauser.sol   # Layer 3: authorized enforcer
│   ├── test/
│   │   ├── BalancerAttackReplay.t.sol   # Layer 1a: deterministic PoC
│   │   ├── RoundTripInvariantTest.t.sol # Layer 1b: stateful fuzzer + rate sweep + multi-pool
│   │   ├── RoundTripHandler.sol         # Single-pool fuzzer handler + ghost variables
│   │   ├── MultiPoolHandler.sol         # Cross-pool sequential drain handler
│   │   ├── MonitorBlocks.t.sol          # Layer 1c: circuit breaker integration test
│   │   └── EdgeCases.t.sol              # 54 unit tests (arithmetic, monitor, pauser)
│   └── cli/
│       ├── scaling-audit.ts      # Layer 2: CLI entry point
│       ├── ast-walker.ts         # Solidity AST traversal
│       ├── rules.ts              # Rounding pair classification
│       ├── reporter.ts           # Markdown + JSON output
│       └── fetcher.ts            # Etherscan + local file loader
├── demo/                         # Next.js live exploit visualizer
│   ├── app/                      # App Router pages + API routes
│   ├── components/               # React UI components
│   └── lib/                      # Types, ABIs, deploy singleton
├── docs/
│   ├── balancer-exploit-deep-dive.md  # Full technical reference
│   └── exploits-overview.md           # Multi-exploit research survey
├── demo.sh                       # End-to-end demo script
├── Makefile                      # Convenience targets
└── .env.example                  # Environment variable template
```
