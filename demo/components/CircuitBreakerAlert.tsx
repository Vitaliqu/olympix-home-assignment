'use client'

import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  tripped: boolean
  tripSwapIndex: number | null
}

export default function CircuitBreakerAlert({ tripped, tripSwapIndex }: Props) {
  return (
    <AnimatePresence>
      {tripped && (
        <motion.div
          initial={{ opacity: 0, y: -6, scaleY: 0.92 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          exit={{ opacity: 0, y: -6, scaleY: 0.92 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          className="border-y border-warn/40 px-6 py-4"
          style={{ background: 'rgba(22,12,0,0.96)', transformOrigin: 'top' }}
        >
          <div className="max-w-7xl mx-auto flex items-start gap-4">
            {/* Icon — shape-based, not color-only */}
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-warn/15 border border-warn/30 flex items-center justify-center text-base leading-none">
              ⚡
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-warn font-bold text-sm font-mono tracking-wide">
                CIRCUIT BREAKER TRIPPED
                {tripSwapIndex !== null && (
                  <span className="text-warn/60 font-normal ml-2">— swap #{tripSwapIndex}</span>
                )}
              </p>

              <p className="text-warn/55 text-xs font-mono mt-1.5 leading-relaxed">
                InvariantMonitor detected reserve1 below threshold for &gt;5 consecutive micro-swaps.
                Invariant D eroded monotonically — each step extracted 1 wei without charging amountIn.
                EmergencyPauser.pause() was called; all further swaps revert with BAL#211.
              </p>

              {/* Detail chips — mechanism for engineers, consequence for observers */}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Chip label="Trigger" value="reserve1 < 100 wei × 5 swaps" />
                <Chip label="Violation" value="Δk < 0 on each step" />
                <Chip label="Action" value="EmergencyPauser.pause(POOL_ID)" />
                <Chip label="Error" value="BAL#211 — pool paused" accent />
              </div>
            </div>

            {/* Observer callout */}
            <div className="hidden lg:flex flex-col items-end gap-1 flex-shrink-0 text-right">
              <span className="text-warn/80 text-xs font-bold font-mono">Pool frozen</span>
              <span className="text-warn/40 text-xs font-mono">no more withdrawals</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-mono rounded px-2 py-0.5 border ${
      accent
        ? 'border-danger/30 bg-danger/10 text-danger/70'
        : 'border-warn/20 bg-warn/5 text-warn/50'
    }`}>
      <span className="text-slate-700">{label}:</span>
      <span>{value}</span>
    </span>
  )
}
