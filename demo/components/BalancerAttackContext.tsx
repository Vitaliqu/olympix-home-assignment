'use client'

import type { DemoPhase } from '@/lib/types'

interface Props {
  phase: DemoPhase
  swapCount: number
}

const CHAINS = ['Ethereum', 'Arbitrum', 'Polygon', 'Optimism', 'Base']

export default function BalancerAttackContext({ phase, swapCount }: Props) {
  return (
    <div className="card border-brand/30 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-base-border flex items-center justify-between flex-wrap gap-2"
        style={{ background: '#161b22' }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-bright" />
          <span className="text-brand-bright text-xs font-bold tracking-wide font-mono">
            Real Balancer Attack — November 3, 2025
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {CHAINS.map((c) => (
            <span key={c} className="text-xs text-brand/50 bg-brand-dim border border-brand/20 rounded px-1.5 py-0.5 font-mono">
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">

        {/* Attack phases */}
        <div className="space-y-2">
          <p className="text-slate-600 text-xs font-mono font-semibold uppercase tracking-widest mb-3">Attack phases</p>
          <Phase
            num="1"
            label="Simulation + positioning"
            detail="~100B simulation iterations identify the exact reserve boundary where mulDown truncates to 0. Targeted swaps push reserve1 to ≤ 9 wei."
            done={phase !== 'idle'}
          />
          <Phase
            num="2"
            label="Atomic batchSwap — D invariant erosion"
            detail="Single transaction. Each step: amountOut = 1, mulDown → 0, StableMath(0) = 0, amountIn = 0. Each free step erodes invariant D, deflating BPT price."
            active={phase === 'running'}
            done={phase === 'complete'}
            swapCount={swapCount}
          />
        </div>

        {/* batchSwap structure */}
        <div>
          <p className="text-slate-600 text-xs font-mono font-semibold uppercase tracking-widest mb-3">
            batchSwap call structure
          </p>
          <div className="code-block p-3 text-xs">
            <div className="text-brand-bright/70">batchSwap(GIVEN_OUT, [</div>
            <div className="text-slate-500 pl-3">{'// N steps, tuned per pool'}</div>
            <div className="text-slate-500 pl-3">{'{'}</div>
            <div className="text-slate-400 pl-5">poolId: CSPOOL_ID,</div>
            <div className="text-slate-400 pl-5">assetInIndex:  WSTETH,</div>
            <div className="text-slate-400 pl-5">assetOutIndex: CBETH,</div>
            <div className="pl-5">
              <span className="text-warn">amount: 1,</span>
              <span className="text-slate-600 ml-2">{'// amountOut (wei)'}</span>
            </div>
            <div className="text-slate-600 pl-5">{'// mulDown → 0 → amountIn = 0'}</div>
            <div className="text-slate-600 pl-5">{'// D erodes by 1 each step'}</div>
            <div className="text-slate-500 pl-3">{'}'}</div>
            <div className="text-brand-bright/70">], assets, funds, ...)</div>
          </div>
        </div>

        {/* Key metrics */}
        <div>
          <p className="text-slate-600 text-xs font-mono font-semibold uppercase tracking-widest mb-3">Key metrics</p>
          <div className="space-y-1.5">
            <KV k="Total loss"           v="~$120–128M"     vc="text-danger" />
            <KV k="Chains affected"      v="5"              vc="text-slate-300" />
            <KV k="Steps per batchSwap"  v="~65 (tuned)"    vc="text-warn" />
            <KV k="cbETH at attack"      v="~9 wei"         vc="text-warn" />
            <KV k="amountIn per step"    v="0 (truncated)"  vc="text-danger" />
            <KV
              k="This demo"
              v={phase === 'idle' ? 'not started' : `${swapCount} / 65 swaps`}
              vc={phase === 'running' ? 'text-safe' : phase === 'complete' ? 'text-warn' : 'text-slate-600'}
            />
            <KV k="Audits that missed"   v="4"              vc="text-slate-500" />
          </div>
        </div>

      </div>
    </div>
  )
}

function Phase({
  num, label, detail, active, done, swapCount,
}: {
  num: string
  label: string
  detail: string
  active?: boolean
  done?: boolean
  swapCount?: number
}) {
  return (
    <div className={`flex gap-3 rounded-lg border p-3 transition-all duration-300 ${
      active ? 'border-brand/40 bg-brand-dim/40'
      : done ? 'border-brand/20 bg-brand-dim/20'
      : 'border-base-border bg-base-surface/30'
    }`}>
      <span className={`flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center font-mono ${
        active || done ? 'bg-brand text-white' : 'bg-base-muted text-slate-600'
      }`}>
        {num}
      </span>
      <div className="min-w-0">
        <p className={`text-xs font-semibold font-mono ${active || done ? 'text-brand-bright' : 'text-slate-500'}`}>
          {label}
          {active && swapCount !== undefined && swapCount > 0 && (
            <span className="ml-2 text-brand/50 font-normal">({swapCount} done)</span>
          )}
          {done && <span className="ml-2 text-safe font-normal">✓</span>}
        </p>
        <p className="text-slate-700 text-xs mt-0.5 font-mono leading-relaxed">{detail}</p>
      </div>
    </div>
  )
}

function KV({ k, v, vc }: { k: string; v: string; vc: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-600 text-xs font-mono">{k}</span>
      <span className={`text-xs font-semibold tabular-nums font-mono ${vc}`}>{v}</span>
    </div>
  )
}
