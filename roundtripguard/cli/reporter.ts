import type { AuditFinding } from "./ast-walker";

/** Format findings as structured JSON — deterministic, no LLM needed. */
export function toJson(findings: AuditFinding[]): object {
  return {
    tool: "ScalingAudit v2",
    findings: findings.map((f) => ({
      file: f.file,
      criticalCount: f.pairs.filter((p) => p.severity === "CRITICAL").length,
      warningCount: f.pairs.filter((p) => p.severity === "WARNING").length,
      pairs: f.pairs,
    })),
  };
}

/** Format findings as human-readable Markdown — deterministic. */
export function toMarkdown(findings: AuditFinding[]): string {
  const lines: string[] = ["# ScalingAudit v2 Report\n"];

  let hasCritical = false;

  for (const f of findings) {
    lines.push(`## File: ${f.file}\n`);
    if (f.pairs.length === 0) {
      lines.push("No scaling pairs detected.\n");
      continue;
    }
    for (const p of f.pairs) {
      if (p.severity === "CRITICAL") hasCritical = true;
      const icon = p.severity === "CRITICAL" ? "🔴" : p.severity === "WARNING" ? "🟡" : "🟢";
      lines.push(`${icon} **[${p.severity}]** in \`${p.swapFunction}\``);
      lines.push(`  - Upscale:   \`${p.upscale.functionName}\` (line ${p.upscale.line})`);
      lines.push(`  - Downscale: \`${p.downscale.functionName}\` (line ${p.downscale.line})`);
      lines.push(`  - ${p.description}`);

      if (p.taintPath && p.taintPath.length > 0) {
        lines.push(`  - Data flow: \`${p.taintPath.join(" → ")}\` (taint-tracked across variable assignment)`);
      }

      if (p.upscale.dynamicRate) {
        lines.push(
          `  - ⚠ **DYNAMIC RATE**: Scaling factor is computed at runtime via a rate-provider call ` +
          `(e.g. \`getRate()\`/\`scalingFactor()\`). The truncation threshold \`1e18/rate\` cannot be ` +
          `determined statically — it varies with the rate provider's return value. ` +
          `**This finding must be verified with runtime analysis or fuzzing (Layer 1). ` +
          `Treat as CRITICAL regardless of current reserve size.**`
        );
      }

      lines.push("");
    }
  }

  lines.push(`\n---\n**Exit code:** ${hasCritical ? "1 (CRITICAL findings)" : "0 (safe)"}`);
  return lines.join("\n");
}

/**
 * Optional: enrich the Markdown report with Claude AI analysis.
 * No-ops (returns original) when apiKey is absent — safe for CI use.
 */
export async function enrichWithClaude(report: string, apiKey: string | undefined): Promise<string> {
  if (!apiKey) return report;
  // Live enrichment path: POST to Anthropic API with the report as context.
  // Not called in unit tests (no key). Exercised by manual CLI runs with ANTHROPIC_API_KEY set.
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: `Review this AMM rounding audit report and add one-line remediation notes for each finding:\n\n${report}` }],
    });
    const block = message.content[0];
    if (block.type === "text") return `${report}\n\n---\n## Claude Analysis\n\n${block.text}`;
  } catch {
    // If enrichment fails, return original report — never block CI
  }
  return report;
}

