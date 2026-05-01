'use client'

import type { DemoMode } from '@/lib/types'

interface Props {
  mode: DemoMode
  onModeChange: (mode: DemoMode) => void
  onRun: () => void
  onReset: () => void
  onSpeedChange: (speed: number) => void
  speed: number
  isRunning: boolean
  simReady: boolean
}

export default function AttackControls({
  mode, onModeChange, onRun, onReset, onSpeedChange, speed, isRunning, simReady,
}: Props) {
  const delayMs = (11 - speed) * 50

  return (
    <div
      className="border-b border-base-border px-4 sm:px-6 py-2.5 flex items-center gap-3 flex-wrap"
      style={{ background: '#161b22' }}
    >
      {/* Mode toggle */}
      <div className="flex bg-base-surface rounded p-0.5 border border-base-border gap-px">
        {(['auto', 'step'] as DemoMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors duration-100 font-mono ${
              mode === m
                ? 'bg-base-muted text-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {m === 'auto' ? 'Auto' : 'Step'}
          </button>
        ))}
      </div>

      {/* Primary action */}
      <button
        onClick={onRun}
        disabled={!simReady}
        className={`text-xs font-semibold px-4 py-1.5 rounded transition-colors duration-100 border font-mono ${
          !simReady
            ? 'bg-base-surface border-base-border text-slate-600 cursor-not-allowed'
            : isRunning
              ? 'bg-base-surface border-base-muted text-slate-300 hover:border-base-muted/80'
              : 'bg-danger border-danger/80 text-white hover:bg-danger/90'
        }`}
      >
        {mode === 'step' ? 'Next Swap →' : isRunning ? '⏸ Pause' : '▶ Run Attack'}
      </button>

      {/* Reset */}
      <button
        onClick={onReset}
        className="text-xs font-medium px-3 py-1.5 rounded border border-base-border text-slate-400 hover:text-slate-200 hover:border-base-muted transition-colors duration-100 font-mono"
      >
        Reset
      </button>

      {/* Speed — auto mode only */}
      {mode === 'auto' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 font-mono">delay</span>
          <input
            type="range"
            min={1}
            max={10}
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="w-20 h-0.5 cursor-pointer accent-brand"
            style={{
              appearance: 'none',
              background: `linear-gradient(to right, #8b5cf6 ${(speed - 1) / 9 * 100}%, #21262d ${(speed - 1) / 9 * 100}%)`,
              borderRadius: '9999px',
            }}
          />
          <span className="text-xs text-slate-600 font-mono tabular-nums w-12">{delayMs}ms</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Simulation status */}
      <div className="flex items-center gap-2 pl-2 border-l border-base-border">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          simReady ? 'bg-safe animate-pulse-slow' : 'bg-danger animate-pulse-subtle'
        }`} />
        <span className="text-xs text-slate-600 font-mono">
          {simReady ? 'Simulation ready' : 'Simulation unavailable'}
        </span>
      </div>
    </div>
  )
}
