#!/usr/bin/env ts-node
import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { fetchSource, loadLocalSource } from "./fetcher";
import { walkSource } from "./ast-walker";
import { toJson, toMarkdown } from "./reporter";

const program = new Command();

program
  .name("scaling-audit")
  .description("Deterministic AMM rounding-asymmetry detector")
  .option("--pool <address>", "Pool contract address (fetches from Etherscan)")
  .option("--file <path>", "Local Solidity file or directory (offline mode)")
  .option("--rpc <url>", "RPC URL (unused — future: on-chain state check)")
  .option("--json", "Output raw JSON instead of Markdown")
  .option(
    "--swap-patterns <patterns>",
    "Comma-separated lowercase substrings to match swap function names (overrides defaults)"
  )
  .option(
    "--dynamic-rate-functions <fns>",
    "Comma-separated function names to treat as dynamic rate providers (overrides defaults)"
  )
  .parse(process.argv);

const opts = program.opts();

/** Load scaling-audit.config.json from CWD if present. */
function loadConfig(): { swapPatterns?: string[]; dynamicRateFunctions?: string[] } {
  const configPath = path.resolve(process.cwd(), "scaling-audit.config.json");
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      swapPatterns: Array.isArray(parsed.swapPatterns) ? parsed.swapPatterns : undefined,
      dynamicRateFunctions: Array.isArray(parsed.dynamicRateFunctions)
        ? parsed.dynamicRateFunctions
        : undefined,
    };
  } catch {
    console.warn("Warning: could not parse scaling-audit.config.json — using defaults");
    return {};
  }
}

async function main() {
  const etherscanKey = process.env.ETHERSCAN_API_KEY ?? "";
  const config = loadConfig();

  // Resolve options: CLI flag > config file > built-in defaults (defaults live in rules.ts)
  const swapPatterns: string[] | undefined = opts.swapPatterns
    ? (opts.swapPatterns as string).split(",").map((s: string) => s.trim().toLowerCase())
    : config.swapPatterns;

  const dynamicRateFunctions: string[] | undefined = opts.dynamicRateFunctions
    ? (opts.dynamicRateFunctions as string).split(",").map((s: string) => s.trim())
    : config.dynamicRateFunctions;

  // Load source
  let sources: { name: string; content: string }[];
  if (opts.file) {
    sources = loadLocalSource(path.resolve(opts.file));
  } else if (opts.pool) {
    if (!etherscanKey) {
      console.error("ETHERSCAN_API_KEY required for --pool mode");
      process.exit(1);
    }
    console.log(`Fetching source for ${opts.pool}...`);
    sources = await fetchSource(opts.pool, etherscanKey);
  } else {
    console.error("Provide --pool <address> or --file <path>");
    process.exit(1);
  }

  // Walk AST with resolved options
  const findings = sources.map((s) =>
    walkSource(s.name, s.content, { swapPatterns, dynamicRateFunctions })
  );

  // Output
  if (opts.json) {
    console.log(JSON.stringify(toJson(findings), null, 2));
  } else {
    console.log(toMarkdown(findings));
  }

  // Exit 1 if any CRITICAL findings
  const hasCritical = findings.some((f) => f.pairs.some((p) => p.severity === "CRITICAL"));
  process.exit(hasCritical ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
