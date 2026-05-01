'use client'

export default function SecurityFinding() {
  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-base-border flex items-center justify-between flex-wrap gap-2"
        style={{ background: '#161b22' }}>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse-subtle" />
            <span className="text-slate-300 text-xs font-bold tracking-wide font-mono">
              ScalingAudit CLI — CRITICAL Finding
            </span>
          </div>
        </div>
        <code className="text-xs text-slate-600 font-mono hidden sm:inline">
          npx ts-node cli/scaling-audit.ts --file MockVulnerablePool.sol
        </code>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: finding details */}
        <div className="space-y-4">
          {/* Severity badge */}
          <div className="flex items-center gap-2">
            <span className="text-danger text-xs font-bold bg-danger-dim border border-danger/30 px-2.5 py-1 rounded-lg font-mono">
              🔴 CRITICAL
            </span>
            <span className="text-slate-500 text-xs font-mono">
              in <span className="text-data">_swapGivenOut</span>
              <span className="text-slate-600 ml-1">· ComposableStablePool</span>
            </span>
          </div>

          {/* Finding rows */}
          <div className="space-y-1.5">
            <Row label="Upscale fn"    value="_upscale → mulDown (L.45)"    color="text-danger/80" />
            <Row label="Invariant"     value="StableMath._calcInGivenOut"   color="text-slate-400" />
            <Row label="Downscale fn"  value="_downscaleUp → divDown (L.52)" color="text-danger/80" />
            <Row label="Net bias"      value="Both round toward zero — ~1 wei/swap toward caller" color="text-warn" />
          </div>

          {/* Scaling factor explainer */}
          <div className="rounded-lg border border-base-border bg-base-surface px-3 py-2.5 font-mono text-xs">
            <p className="text-slate-600 mb-1.5">scalingFactor derivation (USDC, 6 decimals)</p>
            <div className="space-y-0.5">
              <div className="text-slate-600">{'// 10^(18 − decimals) × rateProvider.getRate()'}</div>
              <div>
                <span className="text-data">scalingFactor</span>
                <span className="text-slate-500"> = </span>
                <span className="text-warn">1e12</span>
                <span className="text-slate-500"> × </span>
                <span className="text-slate-400">1.000...e18</span>
                <span className="text-slate-500"> ≈ </span>
                <span className="text-warn">1e12</span>
              </div>
            </div>
          </div>

          {/* Fix */}
          <div className="rounded-lg border border-safe/20 bg-safe-dim px-3 py-2.5">
            <p className="text-safe text-xs font-bold mb-2 font-mono">✓ One-line fix</p>
            <div className="font-mono text-xs space-y-1">
              <div>
                <span className="text-danger/60 line-through">amountIn = _downscaleUp(scaledIn)</span>
                <span className="text-slate-700 ml-2">// divDown</span>
              </div>
              <div>
                <span className="text-safe">amountIn = ⌈ (r0 × amountOut) / (r1 − amountOut) ⌉</span>
                <span className="text-slate-700 ml-2">// ceiling</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: call chain trace */}
        <div>
          <p className="text-slate-600 text-xs font-bold mb-3 uppercase tracking-wider font-mono">
            Full call chain · ComposableStablePool · reserve ~9 wei
          </p>
          <div className="code-block p-4 space-y-1.5">
            <Line dim="// Step 1 — _upscaleArray(balances, scalingFactors)" />
            <Line dim="//   reserves: mulUp — preserved at ceiling" />
            <Line />
            <Line dim="// Step 2 — _upscale(amountOut=1, scalingFactor≈1e12)" />
            <Line code="mulDown(1, 1e12)" result="= (1×1e12)/1e18 = 0  ← signal erased" hot />
            <Line />
            <Line dim="// Step 3 — StableMath._calcInGivenOut(balances, amp, 0)" />
            <Line code="D invariant: f(balances, amp, 0)" result="= 0  ← D unchanged" hot />
            <Line />
            <Line dim="// Step 4 — _downscaleUp(scaledAmountIn=0)" />
            <Line code="divDown(0, 1e12)" result="= 0  ← amountIn = 0, free step" hot />
            <Line />
            <Line dim="// Repeat N× atomically — D erodes, BPT price deflated" />
          </div>

          {/* Audit table */}
          <div className="mt-4 rounded-lg border border-base-border overflow-hidden">
            <div className="bg-base-surface px-3 py-2 text-xs text-slate-600 font-mono font-semibold border-b border-base-border">
              Why 4 audits missed it
            </div>
            {[
              ['Trail of Bits', '2021', 'Verified FixedPoint library in isolation — mulDown and divDown are both arithmetically correct individually'],
              ['Certora',       '2022', 'Formal spec verified per-swap invariant; noted rounding "expected to be minimal" — wrong at wei-scale; multi-call sequences out of scope'],
              ['OpenZeppelin',  '2022', 'Standard checklist: reentrancy, access control, privilege escalation — precision-loss accumulation is not a recognised category'],
              ['Spearbit',      '2023', 'Scoped to new composability features (pre-minted BPT, vault routing); scaling path treated as pre-verified by prior audits'],
            ].map(([name, year, reason]) => (
              <div key={name} className="grid grid-cols-[80px_40px_1fr] gap-2 px-3 py-1.5 border-b border-base-border/40 text-xs font-mono last:border-0">
                <span className="text-slate-400">{name}</span>
                <span className="text-slate-600">{year}</span>
                <span className="text-slate-600">{reason}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex gap-2 text-xs font-mono">
      <span className="text-slate-600 w-24 flex-shrink-0">{label}</span>
      <span className={color}>{value}</span>
    </div>
  )
}

function Line({ code, result, dim, hot }: {
  code?: string; result?: string; dim?: string; hot?: boolean
}) {
  if (dim !== undefined) return <div className="text-slate-700 text-xs">{dim || ' '}</div>
  if (!code) return <div className="h-1" />
  return (
    <div className={`text-xs ${hot ? 'bg-danger/10 rounded px-1 -mx-1 py-0.5' : ''}`}>
      <span className="text-data">{code}</span>
      {result && <span className="text-warn/70 ml-2">{result}</span>}
    </div>
  )
}
