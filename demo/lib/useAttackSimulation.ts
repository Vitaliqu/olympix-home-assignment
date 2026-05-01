'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { PoolState, SwapLogEntry, ChartPoint, DemoMode, DemoPhase, SwapResult } from '@/lib/types'

const INITIAL_RESERVE1 = 65

const INITIAL_POOL: PoolState = {
  reserve0: 8,
  reserve1: INITIAL_RESERVE1,
  invariant: 8 * INITIAL_RESERVE1,
  paused: false,
  circuitBreakerTripped: false,
  totalExtracted: 0,
  totalPaid: 0,
}

/** All readable state produced by the simulation. */
export interface SimulationState {
  vulnState: PoolState
  protState: PoolState
  swapLog: SwapLogEntry[]
  chartData: ChartPoint[]
  mode: DemoMode
  speed: number
  isRunning: boolean
  phase: DemoPhase
  simReady: boolean
  deployError: string | null
  tripSwapIndex: number | null
  /** Total tokens extracted from vulnerable pool minus total tokens paid in. */
  phantomProfit: number
  /** 0-100 integer representing batchSwap progress toward 65 steps. */
  attackProgress: number
}

/** All actions the view layer may invoke. */
export interface SimulationActions {
  setMode: (mode: DemoMode) => void
  setSpeed: (speed: number) => void
  handleRun: () => void
  handleReset: () => Promise<void>
}

export type AttackSimulation = SimulationState & SimulationActions

/**
 * Manages all simulation state and HTTP API interaction.
 * Page components are pure view: they read state and call actions.
 * No fetch() calls appear outside this hook.
 */
export function useAttackSimulation(): AttackSimulation {
  const [vulnState, setVulnState] = useState<PoolState>(INITIAL_POOL)
  const [protState, setProtState] = useState<PoolState>(INITIAL_POOL)
  const [swapLog, setSwapLog] = useState<SwapLogEntry[]>([])
  const [chartData, setChartData] = useState<ChartPoint[]>([
    { swap: 0, vulnerableK: INITIAL_POOL.invariant, protectedK: INITIAL_POOL.invariant },
  ])
  const [mode, setMode] = useState<DemoMode>('auto')
  const [speed, setSpeed] = useState(6)
  const [isRunning, setIsRunning] = useState(false)
  const [phase, setPhase] = useState<DemoPhase>('idle')
  const [simReady, setSimReady] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [tripSwapIndex, setTripSwapIndex] = useState<number | null>(null)

  // Stable ref so loop closures can check stop without stale captures.
  const stopRef = useRef(false)

  useEffect(() => {
    fetch('/api/deploy', { method: 'POST' })
      .then((r) => r.json())
      .then((data: { error?: string }) => { if (data.error) setDeployError(data.error) })
      .catch(() => setDeployError('Could not reach Next.js server'))

    fetch('/api/state')
      .then((r) => setSimReady(r.ok))
      .catch(() => setSimReady(false))
  }, [])

  const applySwapResult = useCallback((result: SwapResult) => {
    const vulnR1 = Number(result.vulnerable.reserve1)
    const vulnK = Number(result.vulnerable.invariant)
    const protK = Number(result.protected.invariant)
    const vulnAmountIn = Number(result.vulnerable.amountIn)
    const protAmountIn = Number(result.protected.amountIn)

    setVulnState((prev) => ({
      reserve0: Number(result.vulnerable.reserve0),
      reserve1: vulnR1,
      invariant: vulnK,
      paused: result.vulnerable.paused,
      circuitBreakerTripped: false,
      totalExtracted: prev.totalExtracted + result.vulnerable.amountOut,
      totalPaid: prev.totalPaid + vulnAmountIn,
    }))

    setProtState((prev) => ({
      reserve0: Number(result.protected.reserve0),
      reserve1: Number(result.protected.reserve1),
      invariant: protK,
      paused: result.protected.paused,
      circuitBreakerTripped: result.protected.circuitBreakerTripped,
      totalExtracted: prev.totalExtracted + result.protected.amountOut,
      totalPaid: prev.totalPaid + protAmountIn,
    }))

    const protStatus: SwapLogEntry['protStatus'] =
      result.protected.circuitBreakerTripped ? 'tripped'
      : result.protected.paused ? 'paused'
      : Number(result.protected.reserve1) === 0 ? 'drained'
      : 'ok'

    if (result.protected.circuitBreakerTripped) {
      setTripSwapIndex((prev) => prev ?? result.swapIndex)
    }

    /**
     * Rounding loss per swap:
     *   ExpectedIn = protAmountIn  (what divUp correctly charges — ceil arithmetic)
     *   ActualIn   = vulnAmountIn  (what mulDown charges — floors to 0 at sub-threshold reserves)
     *
     * When mulDown(amountOut=1, scalingFactor≈1e12) = 0 because 1×1e12 < 1e18 (the 18-decimal
     * base unit), StableMath receives amountOut=0 and returns amountIn=0. The pool hands out
     * a token for free. The delta below captures exactly that gap per swap.
     */
    const roundingLoss = Math.max(0, protAmountIn - vulnAmountIn)

    setSwapLog((prev) => [
      ...prev,
      {
        swapIndex: result.swapIndex,
        amountOut: result.vulnerable.amountOut,
        vulnAmountIn,
        vulnInvariant: vulnK,
        protAmountIn,
        protStatus,
        roundingLoss,
      },
    ])

    setChartData((prev) => [
      ...prev,
      { swap: result.swapIndex, vulnerableK: vulnK, protectedK: protK },
    ])

    return { vulnDrained: vulnR1 === 0, swapIndex: result.swapIndex }
  }, [])

  const runOneSwap = useCallback(async (): Promise<{ stop: boolean }> => {
    const res = await fetch('/api/swap', { method: 'POST' })
    if (!res.ok) return { stop: true }
    const result: SwapResult = await res.json()
    const { vulnDrained, swapIndex } = applySwapResult(result)
    if (vulnDrained || swapIndex >= 65) {
      setPhase('complete')
      return { stop: true }
    }
    return { stop: false }
  }, [applySwapResult])

  const runAutoLoop = useCallback(async () => {
    stopRef.current = false
    setIsRunning(true)
    setPhase('running')
    const loop = async () => {
      if (stopRef.current) { setIsRunning(false); return }
      const { stop } = await runOneSwap()
      if (stop || stopRef.current) { setIsRunning(false); return }
      // speed=10 → 50ms delay (fastest); speed=1 → 500ms delay (slowest).
      setTimeout(loop, (11 - speed) * 50)
    }
    loop()
  }, [runOneSwap, speed])

  const handleRun = useCallback(() => {
    fetch('/api/state').then((r) => setSimReady(r.ok)).catch(() => setSimReady(false))
    if (mode === 'step') {
      setPhase('running')
      runOneSwap()
      return
    }
    if (isRunning) {
      stopRef.current = true
      setIsRunning(false)
    } else {
      runAutoLoop()
    }
  }, [mode, isRunning, runOneSwap, runAutoLoop])

  const handleReset = useCallback(async () => {
    stopRef.current = true
    setIsRunning(false)
    setPhase('idle')
    await fetch('/api/reset', { method: 'POST' })
    setVulnState(INITIAL_POOL)
    setProtState(INITIAL_POOL)
    setSwapLog([])
    setChartData([{ swap: 0, vulnerableK: INITIAL_POOL.invariant, protectedK: INITIAL_POOL.invariant }])
    setTripSwapIndex(null)
  }, [])

  const phantomProfit = vulnState.totalExtracted - vulnState.totalPaid
  const attackProgress = Math.round((swapLog.length / 65) * 100)

  return {
    vulnState, protState, swapLog, chartData,
    mode, speed, isRunning, phase,
    simReady, deployError, tripSwapIndex,
    phantomProfit, attackProgress,
    setMode, setSpeed, handleRun, handleReset,
  }
}
