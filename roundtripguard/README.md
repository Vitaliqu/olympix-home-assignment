# RoundTripGuard — Core Security Tool

See the root [README.md](../README.md) for full documentation, architecture, and quickstart commands.

## Quick Commands (from this directory)

```bash
# Build contracts
forge build

# Run all tests (PoC + fuzzer)
forge test -vvv

# Layer 1 — Stateful invariant fuzzer
forge test --match-contract RoundTripInvariantTest -vvv

# Layer 2 — ScalingAudit CLI
npx ts-node cli/scaling-audit.ts --file src/MockVulnerablePool.sol   # CRITICAL
npx ts-node cli/scaling-audit.ts --file src/MockFixedPool.sol        # clean
```
