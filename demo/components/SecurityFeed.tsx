'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SwapLogEntry } from '@/lib/types'

interface Props {
  entries: SwapLogEntry[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export default function SecurityFeed({ entries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hasScrolled = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || entries.length === 0) return

    if (!hasScrolled.current) {
      // On first swap, scroll the terminal container (not the page) to its bottom.
      // Using scrollTop directly targets only the overflow container — scrollIntoView()
      // walks ALL scroll ancestors and can scroll the entire viewport.
      el.scrollTop = el.scrollHeight
      hasScrolled.current = true
      return
    }

    // After the first entry, only auto-scroll if the user is already near the bottom.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    if (nearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [entries.length])

  const freeCount = entries.filter((e) => e.vulnAmountIn === 0).length

  return (
    <div
      className="overflow-hidden rounded-xl border border-base-border"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.03)' }}
    >
      {/* Terminal chrome — macOS-style title bar */}
      <div
        className="px-4 py-2.5 flex items-center gap-3 border-b border-white/[0.06]"
        style={{ background: '#060d1a' }}
      >
        <div className="flex gap-1.5 flex-shrink-0">
          <span className="w-3 h-3 rounded-full bg-[oklch(0.55_0.18_25)]" />
          <span className="w-3 h-3 rounded-full bg-[oklch(0.65_0.18_80)]" />
          <span className="w-3 h-3 rounded-full bg-[oklch(0.55_0.18_145)]" />
        </div>
        <span className="flex-1 text-center text-xs text-slate-700 font-mono tracking-wide select-none">
          security-feed — VulnerablePool · LogSwap events
        </span>
        {freeCount > 0 && (
          <motion.span
            key={freeCount}
            initial={{ scale: 1.15 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.2 }}
            className="text-xs font-mono font-bold text-danger flex-shrink-0"
          >
            ⚠ {freeCount} FREE
          </motion.span>
        )}
      </div>

      {/* Log body */}
      <div
        ref={containerRef}
        className="max-h-64 overflow-y-auto font-mono text-xs"
        style={{ background: '#040c1a' }}
      >
        {entries.length === 0 ? (
          <div className="px-4 py-6 text-slate-700 flex items-center gap-2">
            <span className="text-safe/50 select-none">$</span>
            <span className="animate-pulse">watching VulnerablePool — awaiting swap events...</span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {entries.map((e) => {
              const isFree = e.vulnAmountIn === 0
              const isTripped = e.protStatus === 'tripped'
              return (
                <motion.div
                  key={e.swapIndex}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.12, ease: 'easeOut' }}
                  className={`px-4 py-1 border-b border-white/[0.03] flex items-baseline gap-2 leading-relaxed ${
                    isFree ? 'bg-danger/[0.07]' : ''
                  }`}
                >
                  <span className="text-slate-700 flex-shrink-0 select-none tabular-nums">
                    [{pad2(e.swapIndex)}]
                  </span>
                  <span className="text-slate-600 flex-shrink-0">LogSwap</span>
                  <span className="text-data flex-shrink-0 tabular-nums">out={e.amountOut}w</span>
                  <span className={`flex-shrink-0 tabular-nums ${isFree ? 'text-danger font-bold' : 'text-slate-400'}`}>
                    in={e.vulnAmountIn}w
                  </span>
                  <span className="text-slate-700 flex-shrink-0 tabular-nums">k={e.vulnInvariant}</span>

                  {isFree && (
                    <span className="text-danger/65 ml-1 flex-shrink-0">
                      ⚠ FREE SWAP — mulDown→0
                    </span>
                  )}
                  {isTripped && (
                    <span className="text-warn ml-auto flex-shrink-0">✓ breaker tripped</span>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Footer summary bar */}
      {entries.length > 0 && (
        <div
          className="px-4 py-2 flex items-center gap-3 text-xs font-mono border-t border-white/[0.04]"
          style={{ background: '#050e1c' }}
        >
          <span className="text-slate-700 tabular-nums">{entries.length} events</span>
          <span className="text-slate-800">·</span>
          <span className={`tabular-nums ${freeCount > 0 ? 'text-danger' : 'text-slate-700'}`}>
            {freeCount}/{entries.length} zero-cost
          </span>
          <span className="text-slate-800">·</span>
          <span className="text-slate-700">
            {entries.some((e) => e.protStatus === 'tripped')
              ? '✓ protected pool paused'
              : 'protected pool active'}
          </span>
          <span className="ml-auto text-slate-800 select-none">EOF</span>
        </div>
      )}
    </div>
  )
}
