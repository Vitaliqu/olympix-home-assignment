'use client'

import { motion, AnimatePresence } from 'framer-motion'
import PoolPanel from '@/components/PoolPanel'
import InvariantChart from '@/components/InvariantChart'
import SecurityFeed from '@/components/SecurityFeed'
import RoundingDeltaTracker from '@/components/RoundingDeltaTracker'
import CircuitBreakerAlert from '@/components/CircuitBreakerAlert'
import AttackControls from '@/components/AttackControls'
import AttackSummary from '@/components/AttackSummary'
import SecurityFinding from '@/components/SecurityFinding'
import BalancerAttackContext from '@/components/BalancerAttackContext'
import { useAttackSimulation } from '@/lib/useAttackSimulation'

const INITIAL_RESERVE1 = 65

export default function DemoPage() {
  const {
    vulnState, protState, swapLog, chartData,
    mode, speed, isRunning, phase,
    simReady, deployError, tripSwapIndex,
    phantomProfit, attackProgress,
    setMode, setSpeed, handleRun, handleReset,
  } = useAttackSimulation()

  // Circuit breaker is considered "tripped" once the flag appears on protState OR
  // after we've recorded the swap index — whichever arrives first.
  const isCircuitTripped = protState.circuitBreakerTripped || tripSwapIndex !== null

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 border-b border-base-border"
        style={{ background: '#0d1117' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-lg bg-brand-dim border border-brand/30 flex items-center justify-center">
                <ShieldIcon />
              </div>
              {phase === 'running' && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger animate-pulse" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-brand-bright font-bold text-base tracking-tight font-mono">
                  RoundTripGuard
                </span>
                <span className="hidden sm:inline text-base-border text-sm">·</span>
                <span className="hidden sm:inline text-slate-400 text-sm">Live Exploit Demo</span>
              </div>
              <p className="text-slate-600 text-xs font-mono mt-0.5 hidden sm:block">
                Balancer V2 Composable Stable Pool · Nov 3, 2025 · $121M · TypeScript simulation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {phase !== 'idle' && (
              <div className="hidden md:flex items-center gap-4 text-xs font-mono border border-base-border rounded-lg px-3 py-1.5 bg-base-card">
                <LiveStat label="swaps" value={swapLog.length} color="text-slate-300" />
                <div className="w-px h-3 bg-base-border" />
                <LiveStat
                  label="profit"
                  value={`${phantomProfit}w`}
                  color={phantomProfit > 0 ? 'text-danger' : 'text-slate-500'}
                />
                <div className="w-px h-3 bg-base-border" />
                <LiveStat
                  label="breaker"
                  value={tripSwapIndex !== null ? `#${tripSwapIndex}` : '—'}
                  color={tripSwapIndex !== null ? 'text-data' : 'text-slate-600'}
                />
              </div>
            )}

            <a
              href="https://github.com/Vitaliqu/olympix-home-assignment"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors border border-base-border hover:border-slate-600 rounded-lg px-3 py-1.5 bg-base-card"
            >
              <GitHubIcon />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </header>

      {/* ── Deploy error ──────────────────────────────────────────────────── */}
      {deployError && (
        <div className="bg-danger-dim border-b border-danger/30 px-6 py-2.5 text-danger-bright text-xs flex items-center gap-2 font-mono">
          <span>⚠</span> {deployError}
        </div>
      )}

      {/* ── Hero insight banner ───────────────────────────────────────────── */}
      <div className="border-b border-base-border" style={{ background: '#161b22' }}>
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-slate-100 text-sm font-semibold leading-snug">
                Every individual swap is mathematically correct.{' '}
                <span className="text-danger">The sequence drains the pool.</span>
              </p>
              <div className="flex flex-wrap items-center gap-1 mt-1.5 font-mono text-xs">
                <CodeChip text="_upscale(1, 1e12)" />
                <Arrow />
                <CodeChip text="mulDown = 0" danger />
                <Arrow />
                <CodeChip text="StableMath(0) = 0" />
                <Arrow />
                <CodeChip text="amountIn = 0" danger />
                <span className="text-slate-600 ml-1">· repeat 65× in one</span>
                <CodeChip text="batchSwap" brand />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap sm:flex-col sm:items-end sm:gap-1">
              <span className="text-xs text-slate-600 font-mono">4 audits missed it</span>
              <div className="flex gap-1">
                {['Trail of Bits', 'Certora', 'OpenZeppelin', 'Spearbit'].map((a) => (
                  <span
                    key={a}
                    className="text-xs text-slate-700 bg-base-surface border border-base-border rounded px-1.5 py-0.5 font-mono hidden lg:inline"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <AttackControls
        mode={mode}
        onModeChange={setMode}
        onRun={handleRun}
        onReset={handleReset}
        onSpeedChange={setSpeed}
        speed={speed}
        isRunning={isRunning}
        simReady={simReady}
      />

      {/* ── Circuit breaker alert — outside the freeze zone so it stays readable */}
      <CircuitBreakerAlert tripped={isCircuitTripped} tripSwapIndex={tripSwapIndex} />

      {/* ── Attack progress bar ───────────────────────────────────────────── */}
      {phase !== 'idle' && (
        <div className="border-b border-base-border bg-base-card px-6 py-2 flex items-center gap-3">
          <span className="text-xs text-slate-600 font-mono w-28 flex-shrink-0">
            {phase === 'complete' ? 'complete' : 'batchSwap in progress'}
          </span>
          <div className="flex-1 h-1.5 bg-base-surface rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full progress-fill ${
                phase === 'complete' ? 'bg-danger' : 'bg-danger/70'
              }`}
              style={{ width: `${attackProgress}%` }}
            />
          </div>
          <span className="text-xs font-mono text-slate-500 w-14 text-right flex-shrink-0">
            {swapLog.length} / 65
          </span>
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 sm:px-6 py-6 space-y-5 max-w-7xl mx-auto w-full">
        {/* Real attack context */}
        <BalancerAttackContext phase={phase} swapCount={swapLog.length} />

        {/* Pool panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PoolPanel variant="vulnerable" state={vulnState} initialReserve={INITIAL_RESERVE1} />
          <PoolPanel variant="protected" state={protState} initialReserve={INITIAL_RESERVE1} />
        </div>

        {/* Rounding Delta Tracker + Invariant Chart — paired, same cognitive layer */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RoundingDeltaTracker entries={swapLog} />
          <InvariantChart data={chartData} tripSwapIndex={tripSwapIndex} />
        </div>

        {/* Security Feed */}
        <SecurityFeed entries={swapLog} />

        {/* Attack summary — slides in on completion */}
        <AnimatePresence>
          {phase === 'complete' && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            >
              <AttackSummary
                vulnState={vulnState}
                protState={protState}
                swapLog={swapLog}
                tripSwapIndex={tripSwapIndex}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Security finding */}
        <SecurityFinding />
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-base-border mt-4" style={{ background: '#161b22' }}>
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-slate-500 text-xs font-mono">
              <span className="text-brand-bright font-semibold">RoundTripGuard</span>
              {' '}— DeFi security tool · compositional rounding exploits
            </p>
            <p className="text-slate-700 text-xs mt-0.5 font-mono">
              L1: Foundry fuzzer · L2: ScalingAudit CLI · L3: InvariantMonitor
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {['Next.js 14', 'TypeScript simulation', 'Recharts', 'Framer Motion'].map((t) => (
              <span
                key={t}
                className="text-xs text-slate-700 bg-base-card border border-base-border rounded px-2 py-0.5 font-mono"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </footer>

    </div>
  )
}

function LiveStat({
  label, value, color,
}: {
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  )
}

function CodeChip({ text, danger, brand }: { text: string; danger?: boolean; brand?: boolean }) {
  const color = danger
    ? 'text-danger border-danger/30 bg-danger-dim'
    : brand
      ? 'text-brand-bright border-brand/30 bg-brand-dim'
      : 'text-data border-data/20 bg-base-surface'
  return (
    <span className={`inline-block border rounded px-1.5 py-0.5 font-mono ${color}`}>
      {text}
    </span>
  )
}

function Arrow() {
  return <span className="text-slate-700">→</span>
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  )
}
