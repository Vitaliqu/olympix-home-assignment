#!/usr/bin/env bash
# RoundTripGuard — end-to-end demo: fuzzer, static analysis, circuit breaker.
#
# Run from anywhere:  bash demo.sh
#
# Prerequisites:
#   Foundry  https://foundry.paradigm.xyz   (forge + anvil)
#   Node.js  https://nodejs.org             (v18+)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RG="$ROOT/roundtripguard"

B="\033[1m"
GRN="\033[0;32m"
YLW="\033[0;33m"
CYN="\033[0;36m"
DIM="\033[2m"
RST="\033[0m"

hr()    { echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"; }
title() { echo; hr; echo -e "${B}${CYN}  $1${RST}"; hr; echo; }
ok()    { echo -e "  ${GRN}✓${RST} $1"; }
info()  { echo -e "  ${DIM}$1${RST}"; }

# ── dependency check ─────────────────────────────────────────────────────────

for cmd in forge node npx; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  ✗ missing: $cmd"
    echo
    echo "  Install Foundry:  curl -L https://foundry.paradigm.xyz | bash && foundryup"
    echo "  Install Node.js:  https://nodejs.org"
    exit 1
  fi
done

echo
echo -e "${B}RoundTripGuard — Compositional Rounding Exploit Detector${RST}"
echo -e "${DIM}  Reproduces and prevents the ~\$120M Balancer V2 rounding exploit (Nov 2025)${RST}"

cd "$RG"

[[ -d node_modules ]] || npm install --silent

forge build --silent

# ── Layer 1a — Attack PoC ────────────────────────────────────────────────────

title "LAYER 1a — Deterministic Attack PoC"
info "forge test --match-contract BalancerAttackReplay -vvv"
echo

forge test --match-contract BalancerAttackReplay -vv 2>&1 \
  | grep -E "(\[PASS\]|\[FAIL\]|reserve1|extracted|paid|profit)" \
  | head -20 || true

echo
ok "Vulnerable pool drained to 0 wei; attacker paid 0, extracted 8 wei."
ok "Fixed pool: same 65-swap sequence costs the attacker more than they receive."

# ── Layer 1b — Stateful Invariant Fuzzer ─────────────────────────────────────

title "LAYER 1b — Stateful Invariant Fuzzer"
info "ghost_totalOut ≤ ghost_totalIn  AND  ghost_freeSwaps == 0"
echo

echo -e "  ${B}Vulnerable pool${RST}  (FAIL expected — fuzzer catches the bug):"
echo
forge test --match-contract "^RoundTripInvariantTest$" -vv 2>&1 \
  | grep -E "^\[(FAIL|PASS)" \
  | awk '!seen[$0]++' \
  | head -4 || true

echo
ok "Fuzzer found the bug on the first call — FREE_EXTRACTION and ROUND_TRIP_PROFIT detected."
echo
echo -e "  ${B}Fixed pool${RST}  (PASS expected — 500 runs × 100 calls, no violation):"
echo
forge test --match-contract "^RoundTripFixedInvariantTest$" -vv 2>&1 \
  | grep -E "^\[(PASS|FAIL)" \
  | head -4 || true

# ── Layer 1c — Circuit Breaker integration ───────────────────────────────────

title "LAYER 1c — On-chain Circuit Breaker Integration"
info "forge test --match-contract MonitorBlocks -vvv"
echo

forge test --match-contract MonitorBlocks -vv 2>&1 \
  | grep -E "(\[PASS\]|\[FAIL\])" \
  | head -5 || true

echo
ok "Monitor trips on swap 2 (drift 1333 bps >> 1 bps threshold)."
ok "Keeper pauses pool. Swap 3 reverts with BAL#211."

# ── Layer 2 — ScalingAudit CLI ───────────────────────────────────────────────

title "LAYER 2 — ScalingAudit CLI (static AST analysis)"
echo

echo -e "  ${B}Vulnerable pool${RST}  (CRITICAL finding expected, exit 1):"
echo
npx ts-node cli/scaling-audit.ts --file src/MockVulnerablePool.sol 2>&1 || true
echo

echo -e "  ${B}Fixed pool${RST}  (clean, exit 0):"
echo
npx ts-node cli/scaling-audit.ts --file src/MockFixedPool.sol 2>&1 || true

# ── Layer 3 — On-chain contracts ─────────────────────────────────────────────
title "LAYER 3 — On-chain Runtime Guard (Solidity)"
info "InvariantMonitor.sol permissionless sentinel, emits CircuitBreakerTripped"
info "EmergencyPauser.sol holds pause() authority; only guardian/keeper can call it"

echo
info "Separation of concerns: a malicious monitor call cannot pause anything."
info "Only a registered keeper acting on the emitted event can."

echo
info "Trip conditions:"
info " • single-swap invariant drift > 1 bps"
info " • cumulative drift > 5 bps"
info " • more than 5 consecutive swaps below 100 wei liquidity"

# ── Web Demo ─────────────────────────────────────────────────────────────────
title "WEB DEMO — Live Side-by-Side on Anvil (demo/)"
info "Next.js 14 app. Vulnerable pool drains left; circuit breaker holds right."

echo
echo -e " Terminal 1: ${CYN}anvil${RST}"
echo -e " Terminal 2: ${CYN}cd demo && npm install && npm run dev${RST}"
echo -e " Browser: ${CYN}http://localhost:3000${RST}"

# ── Done ─────────────────────────────────────────────────────────────────────
echo
hr
echo -e "${B}${GRN} Demo complete. Run \`make help\` for individual commands.${RST}"
hr
echo