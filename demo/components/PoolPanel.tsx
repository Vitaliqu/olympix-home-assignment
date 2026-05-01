'use client'

import { motion } from 'framer-motion'
import type { PoolState } from '@/lib/types'

interface Props {
  variant: 'vulnerable' | 'protected'
  state: PoolState
  initialReserve?: number
}

export default function PoolPanel({ variant, state, initialReserve = 65 }: Props) {
  const isVuln = variant === 'vulnerable'
  const profit = state.totalExtracted - state.totalPaid
  const reservePct = Math.max(0, Math.round((state.reserve1 / initialReserve) * 100))
  const isDraining = isVuln && reservePct < 100 && profit > 0

  // Banner text — strings are asserted by PoolPanel.test.tsx, keep exact.
  const banner = isVuln
    ? profit > 0
      ? { text: '⚡ EXPLOIT ACTIVE — amountIn rounds to 0 each swap', cls: 'border-danger/30 bg-danger-dim text-danger-bright' }
      : { text: 'Awaiting attack…', cls: 'border-base-border text-slate-600' }
    : state.circuitBreakerTripped || state.paused
      ? { text: '🛡 CIRCUIT BREAKER TRIPPED — swaps blocked', cls: 'border-warn/30 bg-warn-dim text-warn-bright' }
      : { text: '✓ PROTECTED — divUp fix + InvariantMonitor active', cls: 'border-safe/20 bg-safe-dim text-safe-bright' }

  // Card border — colored ring communicates state; no glow spread.
  const cardBorder = isVuln
    ? profit > 0 ? 'ring-danger' : 'border-base-border'
    : state.circuitBreakerTripped ? 'ring-warn' : 'ring-safe'

  // Status badge
  const badge = isVuln
    ? state.reserve1 === 0
      ? { text: 'DRAINED', cls: 'bg-danger/15 text-danger border-danger/30' }
      : profit > 0
        ? { text: 'EXPLOITING', cls: 'bg-danger/10 text-danger border-danger/25 animate-pulse-subtle' }
        : { text: 'IDLE', cls: 'bg-base-surface text-slate-500 border-base-border' }
    : state.paused
      ? { text: 'BLOCKED', cls: 'bg-warn/10 text-warn border-warn/30' }
      : { text: 'GUARDED', cls: 'bg-safe/10 text-safe border-safe/25' }

  // Status dot color
  const dotColor = isVuln
    ? profit > 0 ? 'bg-danger animate-blink-danger' : 'bg-base-muted'
    : state.circuitBreakerTripped ? 'bg-warn' : 'bg-safe animate-pulse-slow'

  // Reserve number color shifts as pool drains
  const reserveInitialColor = '#58a6ff'   // data blue — flash on every update
  const reserveFinalColor = reservePct === 0 ? '#f85149'
    : reservePct < 30 ? '#f85149'
    : reservePct < 70 ? '#d29922'
    : '#e6edf3'

  return (
    <div className={`card border overflow-hidden transition-colors duration-300 ${cardBorder}`}>

      {/* ── Header — flat, no gradient ────────────────────────────────── */}
      <div
        className="px-4 py-3 border-b border-base-border flex items-center justify-between"
        style={{ background: '#161b22' }}
      >
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
          <div>
            <span className={`text-xs font-semibold tracking-wide font-mono ${
              isVuln ? 'text-danger' : state.circuitBreakerTripped ? 'text-warn' : 'text-safe'
            }`}>
              {isVuln ? 'VULNERABLE POOL' : 'PROTECTED POOL'}
            </span>
            <p className="text-slate-600 text-xs font-mono mt-0.5">
              {isVuln ? 'MockVulnerablePool.sol' : 'MockFixedPool.sol + InvariantMonitor'}
            </p>
          </div>
        </div>
        {/* Rectangular badge — tools use rounded, not rounded-full pills */}
        <span className={`text-xs px-2 py-0.5 rounded font-semibold border font-mono ${badge.cls}`}>
          {badge.text}
        </span>
      </div>

      <div className="p-4 space-y-4" style={{ background: 'rgba(13,18,30,0.5)' }}>

        {/* ── Reserve — primary metric, deserves the most visual weight ─ */}
        <div>
          <span className="text-slate-500 text-xs font-mono">token1 reserve</span>
          <div className="flex items-baseline gap-2 mt-1">
            <motion.span
              key={state.reserve1}
              initial={{ color: reserveInitialColor }}
              animate={{ color: reserveFinalColor }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="text-5xl font-bold tabular-nums font-mono leading-none"
            >
              {state.reserve1}
            </motion.span>
            <span className="text-slate-500 text-sm font-mono">wei</span>
            <span className={`text-xs font-mono ml-auto tabular-nums ${
              reservePct < 30 ? 'text-danger' : 'text-slate-600'
            }`}>
              {reservePct}%
            </span>
          </div>

          {/* Reserve bar */}
          <div className="mt-2.5 h-1.5 rounded-full overflow-hidden bg-base-surface">
            <motion.div
              className={`h-full rounded-full ${
                isVuln
                  ? reservePct === 0 ? 'bg-danger/20'
                    : isDraining ? 'bg-danger animate-drain'
                      : 'bg-danger/50'
                  : 'bg-safe'
              }`}
              animate={{ width: `${reservePct}%` }}
              transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            />
          </div>
        </div>

        {/* ── Stats — flat key/value rows, no nested cards ────────────── */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1 border-t border-base-border/50">
          <StatRow label="reserve0"   value={state.reserve0}          unit="wei" />
          <StatRow
            label="invariant k"
            value={state.invariant}
            accent={isVuln && state.invariant < 8 * initialReserve ? 'danger' : undefined}
          />
          <StatRow
            label="extracted"
            value={`${state.totalExtracted} wei`}
            accent={isVuln && state.totalExtracted > 0 ? 'danger' : undefined}
          />
          <StatRow label="paid in"    value={`${state.totalPaid} wei`} />
        </div>

        {/* ── Phantom profit — typographic row, not a nested box ──────── */}
        <div className="flex items-baseline justify-between pt-3 border-t border-base-border/50">
          <div>
            <span className="text-slate-500 text-xs font-mono">phantom profit</span>
            {profit > 0 && (
              <p className="text-danger/50 text-xs font-mono mt-0.5">
                {state.totalPaid === 0 ? 'nothing — gas only' : `${state.totalPaid} wei total`}
              </p>
            )}
          </div>
          <motion.span
            key={profit}
            initial={{ scale: profit > 0 ? 1.06 : 1 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={`text-2xl font-bold tabular-nums font-mono ${
              profit > 0 ? 'text-danger' : 'text-slate-700'
            }`}
          >
            {profit > 0 ? `+${profit}` : '0'}
            <span className="text-xs ml-1 font-normal text-slate-600">wei</span>
          </motion.span>
        </div>

        {/* ── Status banner ────────────────────────────────────────────── */}
        <div className={`rounded border px-3 py-2 text-xs font-semibold font-mono ${banner.cls}`}>
          {banner.text}
        </div>

      </div>
    </div>
  )
}

interface StatRowProps {
  label: string
  value: string | number
  unit?: string
  accent?: 'danger' | 'safe'
}

function StatRow({ label, value, unit, accent }: StatRowProps) {
  const valueColor = accent === 'danger' ? 'text-danger'
    : accent === 'safe' ? 'text-safe'
    : 'text-slate-300'
  return (
    <div>
      <p className="text-slate-600 text-xs font-mono">{label}</p>
      <p className={`text-sm font-semibold tabular-nums font-mono mt-0.5 ${valueColor}`}>
        {String(value)}
        {unit && <span className="text-slate-600 text-xs ml-1 font-normal">{unit}</span>}
      </p>
    </div>
  )
}
