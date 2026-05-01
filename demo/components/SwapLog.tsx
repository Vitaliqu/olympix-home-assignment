'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SwapLogEntry } from '@/lib/types'

interface Props {
  entries: SwapLogEntry[]
}

const PROT_STATUS: Record<SwapLogEntry['protStatus'], { label: string; cls: string }> = {
  ok:      { label: 'ok',          cls: 'text-slate-600' },
  tripped: { label: '⚡ TRIPPED',  cls: 'text-warn font-bold' },
  paused:  { label: '🔒 PAUSED',  cls: 'text-warn-bright' },
  drained: { label: '💀 DRAINED', cls: 'text-danger font-bold' },
}

export default function SwapLog({ entries }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [entries.length])

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-base-border flex items-center justify-between"
        style={{ background: '#161b22' }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-data" />
          <span className="text-slate-300 text-xs font-bold tracking-wide font-mono">Swap Log</span>
        </div>
        <div className="flex items-center gap-3">
          {entries.length > 0 && (
            <span className="text-xs text-danger font-mono">
              {entries.filter((e) => e.vulnAmountIn === 0).length} free swaps
            </span>
          )}
          <span className="text-slate-600 text-xs font-mono">
            {entries.length} / 65
          </span>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-7 gap-1 px-5 py-2 bg-base-surface/50 border-b border-base-border/60">
        {['#', 'out', 'vuln amountIn (2 cols)', '', 'vuln k', 'prot in', 'prot status'].map((h, i) => (
          <span key={i} className={`text-slate-600 text-xs font-mono font-semibold ${i === 2 ? 'col-span-2' : ''} ${i === 3 ? 'hidden' : ''}`}>
            {i === 3 ? '' : h}
          </span>
        ))}
      </div>

      <div className="max-h-56 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-slate-600 text-xs font-mono">No swaps yet — hit Run Attack to start</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {entries.map((e, i) => {
              const isFree    = e.vulnAmountIn === 0
              const isTripped = e.protStatus === 'tripped'

              return (
                <motion.div
                  key={e.swapIndex}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className={`grid grid-cols-7 gap-1 px-5 py-1.5 text-xs border-b border-base-border/30 font-mono ${
                    isTripped
                      ? 'bg-warn-dim/30'
                      : isFree
                        ? 'bg-danger-dim/20'
                        : i % 2 === 0 ? 'bg-transparent' : 'bg-base-surface/20'
                  }`}
                >
                  <span className="text-slate-600">{e.swapIndex}</span>
                  <span className="text-slate-400">{e.amountOut}w</span>

                  {/* vuln amountIn — col-span-2 */}
                  <span className={`col-span-2 ${isFree ? 'text-danger font-bold' : 'text-slate-300'}`}>
                    {e.vulnAmountIn} wei
                    {isFree && (
                      <span className="ml-1.5 text-danger/50 text-xs font-normal">
                        mulDown=0
                      </span>
                    )}
                  </span>

                  <span className={e.vulnInvariant < 65 ? 'text-danger' : 'text-slate-500'}>
                    {e.vulnInvariant}
                  </span>

                  <span className={e.protStatus === 'paused' ? 'text-slate-700' : 'text-slate-300'}>
                    {e.protStatus === 'paused' ? '—' : `${e.protAmountIn}w`}
                  </span>

                  <span className={PROT_STATUS[e.protStatus].cls}>
                    {PROT_STATUS[e.protStatus].label}
                  </span>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
