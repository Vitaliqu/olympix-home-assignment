.PHONY: build test fuzz audit demo clean

# Build all Solidity contracts
build:
	forge build

# Run the full test suite (unit + invariant)
test:
	forge test -vvv

# Run only the stateful invariant fuzzer (Layer 1)
fuzz:
	forge test --match-contract "RoundTripInvariantTest|RoundTripRateSweepTest|MultiPoolInvariantTest" -vvv

# Run the static AST analyzer on the vulnerable pool (Layer 2) — exits 1 if CRITICAL found
audit:
	npx ts-node cli/scaling-audit.ts --file src/MockVulnerablePool.sol

# Full demo: show the exploit + the fix
demo:
	forge test --match-contract BalancerAttackReplay -vvv

# Remove build artifacts
clean:
	forge clean
