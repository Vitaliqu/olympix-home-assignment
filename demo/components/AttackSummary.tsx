'use client'

import { motion, type Variants } from 'framer-motion'
import type { PoolState, SwapLogEntry } from '@/lib/types'

interface Props {
  vulnState: PoolState
  protState: PoolState
  swapLog: SwapLogEntry[]
  tripSwapIndex: number | null
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] } },
}

export default function AttackSummary({ vulnState, protState, swapLog, tripSwapIndex }: Props) {
  const totalSwaps    = swapLog.length
  const freeSwaps     = swapLog.filter((e) => e.vulnAmountIn === 0).length
  const phantomProfit = vulnState.totalExtracted - vulnState.totalPaid

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="card border-warn/30 overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-base-border flex items-center justify-between flex-wrap gap-2"
        style={{ background: '#161b22' }}>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-warn/20 border border-warn/40 flex items-center justify-center text-xs">
            ⚡
          </div>
          <div>
            <span className="text-warn font-bold text-sm tracking-wide font-mono">ATTACK COMPLETE</span>
            <p className="text-warn/40 text-xs font-mono mt-0.5">vulnerability confirmed — see findings below</p>
          </div>
        </div>
        <span className="text-xs text-warn/50 font-mono hidden sm:inline">
          real attack: ~{totalSwaps} steps · one atomic{' '}
          <span className="text-brand-bright/60">IVault.batchSwap</span>
          {' '}· D invariant erosion · Nov 3, 2025
        </span>
      </div>

      {/* Stats */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4"
        style={{ background: 'rgba(8,15,30,0.4)' }}
      >
        <motion.div variants={item}>
          <Stat
            label="Micro-swaps"
            value={String(totalSwaps)}
            sub={`each via swapGivenOut(1)`}
            color="text-slate-200"
          />
        </motion.div>
        <motion.div variants={item}>
          <Stat
            label="Phantom profit"
            value={`+${phantomProfit} wei`}
            sub={`${freeSwaps}/${totalSwaps} had amountIn = 0`}
            color="text-danger"
            pulse
          />
        </motion.div>
        <motion.div variants={item}>
          <Stat
            label="Attacker paid"
            value={vulnState.totalPaid === 0 ? '0 wei' : `${vulnState.totalPaid} wei`}
            sub="real cost: gas only"
            color={vulnState.totalPaid === 0 ? 'text-danger' : 'text-slate-300'}
          />
        </motion.div>
        <motion.div variants={item}>
          <Stat
            label="Circuit breaker"
            value={tripSwapIndex !== null ? `swap #${tripSwapIndex}` : 'not triggered'}
            sub={tripSwapIndex !== null ? 'EmergencyPauser.pause(poolId) called' : 'no monitor deployed'}
            color={tripSwapIndex !== null ? 'text-safe' : 'text-slate-600'}
          />
        </motion.div>
      </motion.div>

      {/* Findings */}
      <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Finding
          title="Why it worked — Vulnerable Pool"
          lines={[
            '_upscale(amountOut=1, 1e12) → mulDown = 0   ← signal zeroed',
            'StableMath._calcInGivenOut(balances, amp, 0) = 0   ← D unchanged',
            'divDown(0, 1e12) = 0   ← amountIn = 0, invariant D eroded by 1',
          ]}
          color="danger"
        />
        <Finding
          title="Why it was stopped — Protected Pool"
          lines={[
            'swapGivenOut(1) → mulUp: amountIn = ⌈r0/(r1−1)⌉ ≥ 1 always',
            'InvariantMonitor: >5 swaps at reserve < 100 wei → TRIP',
            'EmergencyPauser.pause(poolId) → all swaps revert BAL#211',
          ]}
          color="safe"
        />
      </div>
    </motion.div>
  )
}

function Stat({ label, value, sub, color, pulse }: {
  label: string; value: string; sub: string; color: string; pulse?: boolean
}) {
  return (
    <div>
      <p className="text-slate-600 text-xs mb-1 font-mono">{label}</p>
      <p className={`text-2xl font-bold tabular-nums font-mono ${color} ${pulse ? 'animate-pulse-subtle' : ''}`}>
        {value}
      </p>
      <p className="text-slate-600 text-xs mt-0.5 font-mono">{sub}</p>
    </div>
  )
}

function Finding({ title, lines, color }: {
  title: string; lines: string[]; color: 'danger' | 'safe'
}) {
  const borderCls  = color === 'danger' ? 'border-danger/20' : 'border-safe/20'
  const titleColor = color === 'danger' ? 'text-danger' : 'text-safe'
  const lineColor  = color === 'danger' ? 'text-danger/60' : 'text-safe/60'

  return (
    <div className={`rounded-xl border ${borderCls} px-4 py-3.5`}
      style={{ background: color === 'danger' ? 'rgba(26,5,5,0.4)' : 'rgba(2,18,9,0.4)' }}>
      <p className={`text-xs font-bold mb-3 font-mono ${titleColor}`}>{title}</p>
      <ul className="space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className={`text-xs font-mono ${lineColor} leading-relaxed`}>{l}</li>
        ))}
      </ul>
    </div>
  )
}
