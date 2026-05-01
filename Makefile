.PHONY: help demo poc fuzz audit monitor build install clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  %-12s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

demo: ## Run the full end-to-end demo (fuzzer, static analysis, circuit breaker)
	@bash demo.sh

build: ## Compile Solidity contracts
	@cd roundtripguard && forge build

install: ## Install all dependencies (forge libs + npm)
	@cd roundtripguard && forge install 2>/dev/null || true
	@cd roundtripguard && npm install

poc: ## Layer 1a — deterministic attack replay PoC
	@cd roundtripguard && forge test --match-contract BalancerAttackReplay -vvv

fuzz: ## Layer 1b — stateful invariant fuzzer (fails on vulnerable pool)
	@cd roundtripguard && forge test --match-contract RoundTripInvariantTest -vvv
	@cd roundtripguard && forge test --match-contract RoundTripFixedInvariantTest -vvv

monitor-test: ## Layer 1c — on-chain circuit breaker integration test
	@cd roundtripguard && forge test --match-contract MonitorBlocks -vvv

audit: ## Layer 2 — ScalingAudit CLI on the mock pools
	@echo "--- Vulnerable pool (expect CRITICAL, exit 1) ---"
	@cd roundtripguard && npx ts-node cli/scaling-audit.ts --file src/MockVulnerablePool.sol; true
	@echo "--- Fixed pool (expect clean, exit 0) ---"
	@cd roundtripguard && npx ts-node cli/scaling-audit.ts --file src/MockFixedPool.sol; true

test: ## Run all Foundry tests
	@cd roundtripguard && forge test -vv

clean: ## Remove build artifacts
	@cd roundtripguard && forge clean
