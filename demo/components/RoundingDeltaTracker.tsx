'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SwapLogEntry, RoundingDeltaPoint } from '@/lib/types'

interface Props {
  entries: SwapLogEntry[]
}

/**
 * Derives per-swap and cumulative loss from the swap log.
 *
 * Rounding loss formula:
 *   loss = ExpectedIn − ActualIn
 *        = protAmountIn − vulnAmountIn
 *
 * protAmountIn uses divUp (ceiling arithmetic), so it always charges ≥1 wei when
 * a legitimate token out is requested. vulnAmountIn uses mulDown → rounds to 0 when
 * amountOut × scalingFactor < 1e18 (the 18-decimal unit base). At reserve1 ≈ 9 wei
 * and scalingFactor ≈ 1e12, any amountOut=1 satisfies 1 × 1e12 < 1e18, so every
 * single swap in the batchSwap is free.
 */
function buildDeltaPoints(entries: SwapLogEntry[]): RoundingDeltaPoint[] {
  let running = 0
  return entries.map((e) => {
    running += e.roundingLoss
    return { swapIndex: e.swapIndex, loss: e.roundingLoss, cumulativeLoss: running }
  })
}

export default function RoundingDeltaTracker({ entries }: Props) {
  const points = useMemo(() => buildDeltaPoints(entries), [entries])

  const totalLoss = points[points.length - 1]?.cumulativeLoss ?? 0
  const freeCount = entries.filter((e) => e.vulnAmountIn === 0).length
  const paidCount = entries.length - freeCount

  if (entries.length === 0) {
    return (
      <div className="card p-5 flex flex-col justify-between" style={{ minHeight: '9rem' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-data" />
            <span className="text-slate-300 text-xs font-bold tracking-wide font-mono">Rounding Delta Tracker</span>
          </div>
          <span className="text-slate-700 text-xs font-mono">Loss = ExpectedIn − ActualIn</span>
        </div>
        <p className="text-slate-700 text-xs font-mono">No swaps yet</p>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div
        className="px-5 py-3 border-b border-base-border flex items-center justify-between"
        style={{ background: '#161b22' }}
      >
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-data" />
          <span className="text-slate-300 text-xs font-bold tracking-wide font-mono">
            Rounding Delta Tracker
          </span>
        </div>
        <span className="text-slate-600 text-xs font-mono">
          Loss = ExpectedIn − ActualIn
        </span>
      </div>

      <div className="p-5 space-y-5">
        {/* Summary — horizontal stat bar, no nested cards */}
        <div className="flex items-baseline gap-6 flex-wrap">
          <InlineStat
            label="Total loss"
            value={`${totalLoss} wei`}
            accent={totalLoss > 0 ? 'danger' : 'neutral'}
          />
          <span className="text-base-border self-center">·</span>
          <InlineStat
            label="Free swaps"
            value={`${freeCount} / ${entries.length}`}
            accent={freeCount > 0 ? 'danger' : 'neutral'}
          />
          <span className="text-base-border self-center">·</span>
          <InlineStat
            label="Paid correctly"
            value={`${paidCount} / ${entries.length}`}
            accent="neutral"
          />
        </div>

        {/* Per-swap delta list */}
        <div className="space-y-px max-h-44 overflow-y-auto">
          <AnimatePresence initial={false}>
            {points.map((p, i) => {
              const isFree = p.loss > 0
              return (
                <motion.div
                  key={p.swapIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className={`flex items-center gap-3 px-3 py-1.5 rounded text-xs font-mono ${
                    isFree ? 'bg-danger/[0.06]' : 'bg-transparent'
                  }`}
                >
                  {/* Swap index */}
                  <span className="text-slate-700 w-5 text-right flex-shrink-0 tabular-nums">
                    {p.swapIndex}
                  </span>

                  {/* Status icon — shape-based for colorblindness */}
                  <span className={`flex-shrink-0 ${isFree ? 'text-danger' : 'text-safe/60'}`}>
                    {isFree ? '⚠' : '✓'}
                  </span>

                  {/* Loss amount */}
                  <span className={`flex-shrink-0 w-20 tabular-nums ${
                    isFree ? 'text-danger font-bold' : 'text-slate-600'
                  }`}>
                    {isFree ? `+${p.loss}w loss` : 'paid correctly'}
                  </span>

                  {/* Mini bar */}
                  <div className="flex-1 h-1 rounded-full bg-base-surface overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${isFree ? 'bg-danger/60' : 'bg-safe/30'}`}
                      initial={{ width: 0 }}
                      animate={{ width: isFree ? '100%' : '0%' }}
                      transition={{ duration: 0.3, delay: i * 0.01 }}
                    />
                  </div>

                  {/* Running total */}
                  <span className="text-slate-600 tabular-nums w-16 text-right flex-shrink-0">
                    Σ {p.cumulativeLoss}w
                  </span>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>

        {/* Observer-layer callout */}
        {freeCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="rounded-lg border border-danger/20 px-4 py-3 text-xs font-mono"
            style={{ background: 'rgba(26,5,5,0.5)' }}
          >
            <span className="text-danger font-bold">⚠ Math gap detected.</span>
            <span className="text-danger/60 ml-2">
              The vulnerable pool collected 0 wei for {freeCount} swap{freeCount !== 1 ? 's' : ''} that
              dispensed {freeCount} wei of token1. mulDown erased the signal before StableMath could price it.
            </span>
          </motion.div>
        )}
      </div>
    </div>
  )
}

interface InlineStatProps {
  label: string
  value: string
  accent: 'danger' | 'neutral'
}

function InlineStat({ label, value, accent }: InlineStatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-slate-600 text-xs font-mono">{label}</span>
      <span className={`text-lg font-bold tabular-nums font-mono ${
        accent === 'danger' ? 'text-danger' : 'text-slate-400'
      }`}>
        {value}
      </span>
    </div>
  )
}
