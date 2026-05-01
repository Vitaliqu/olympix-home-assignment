// demo/lib/simulation.ts

// ── Fixed-point helpers (mirrors FixedPoint.sol) ──────────────────────────────
// BigInt() constructor form prevents @vercel/nft from attempting static evaluation
const ONE = BigInt('1000000000000000000')  // 1e18
const SF  = BigInt('1000000000000')         // 1e12 — SCALING_FACTOR for 6-decimal tokens

function mulDown(a: bigint, b: bigint): bigint { return (a * b) / ONE }
function mulUp(a: bigint, b: bigint): bigint   { return (a * b + ONE - BigInt(1)) / ONE }
function divDown(a: bigint, b: bigint): bigint  { return (a * ONE) / b }

// ── InvariantMonitor constants ────────────────────────────────────────────────
const DRIFT_BPS_THRESHOLD     = BigInt(1)
const CUMULATIVE_DRIFT_BPS    = BigInt(5)
const LOW_LIQUIDITY_WEI       = BigInt(100)
const MAX_SWAPS_LOW_LIQUIDITY = BigInt(5)

// ── State types ───────────────────────────────────────────────────────────────
export interface PoolSim {
  reserve0: bigint
  reserve1: bigint
  paused: boolean
}

export interface MonitorSim {
  lastInvariant: bigint
  cumulativeDrift: bigint
  swapsSinceReset: bigint
  circuitBreakerTripped: boolean
}

export interface SimState {
  vuln: PoolSim
  prot: PoolSim
  monitor: MonitorSim
  swapCount: number
}

export interface StepResult {
  swapIndex: number
  vulnerable: {
    amountIn: string
    amountOut: number
    reserve0: string
    reserve1: string
    invariant: string
    paused: boolean
    reverted: boolean
  }
  protected: {
    amountIn: string
    amountOut: number
    reserve0: string
    reserve1: string
    invariant: string
    paused: boolean
    circuitBreakerTripped: boolean
    reverted: boolean
  }
}

const INITIAL_R0 = BigInt(8)
const INITIAL_R1 = BigInt(65)

// Module-level singleton — survives across requests in one Next.js process
let _state: SimState | null = null

function freshState(): SimState {
  return {
    vuln:    { reserve0: INITIAL_R0, reserve1: INITIAL_R1, paused: false },
    prot:    { reserve0: INITIAL_R0, reserve1: INITIAL_R1, paused: false },
    monitor: { lastInvariant: BigInt(0), cumulativeDrift: BigInt(0), swapsSinceReset: BigInt(0), circuitBreakerTripped: false },
    swapCount: 0,
  }
}

export function initSimulation(): void {
  if (!_state) _state = freshState()
}

export function resetSimulation(): void {
  _state = null
}

export function getSimState(): Readonly<SimState> | null {
  return _state
}

// ── Pool math ─────────────────────────────────────────────────────────────────

/**
 * MockVulnerablePool.swapGivenOut — mulDown bug causes free swaps.
 * Returns amountIn (0 when bug triggers).
 * Throws if paused or insufficient liquidity.
 */
function vulnSwap(amountOut: bigint): bigint {
  const pool = _state!.vuln
  if (pool.paused) throw new Error('BAL#211')
  if (amountOut > pool.reserve1) throw new Error('INSUFFICIENT_LIQUIDITY')

  const scaledR0  = mulUp(pool.reserve0, SF)
  const scaledR1  = mulUp(pool.reserve1, SF)
  const scaledOut = mulDown(amountOut, SF)          // BUG: → 0 for amountOut < 1e6
  const denom     = scaledR1 - scaledOut
  const scaledIn  = denom > BigInt(0) ? (scaledR0 * scaledOut) / denom : BigInt(0)
  const amountIn  = divDown(scaledIn, SF)

  pool.reserve0 += amountIn
  pool.reserve1 -= amountOut
  return amountIn
}

/**
 * MockFixedPool.swapGivenOut — ceiling division ensures amountIn >= 1.
 * Returns amountIn.
 * Throws if paused or insufficient liquidity.
 */
function protSwap(amountOut: bigint): bigint {
  const pool = _state!.prot
  if (pool.paused) throw new Error('BAL#211')
  if (amountOut >= pool.reserve1) throw new Error('INSUFFICIENT_LIQUIDITY')

  const numerator   = pool.reserve0 * amountOut
  const denominator = pool.reserve1 - amountOut
  const amountIn    = (numerator + denominator - BigInt(1)) / denominator  // divUp

  pool.reserve0 += amountIn
  pool.reserve1 -= amountOut
  return amountIn
}

/**
 * InvariantMonitor.checkAfterSwap — returns true if circuit breaker is now tripped.
 * Mirrors the Solidity logic exactly (drift BPS thresholds + low-liquidity guard).
 */
function monitorCheck(): boolean {
  const m    = _state!.monitor
  const pool = _state!.prot
  if (m.circuitBreakerTripped) return true

  const currentInvariant = pool.reserve0 * pool.reserve1

  if (pool.reserve1 < LOW_LIQUIDITY_WEI) {
    m.swapsSinceReset++
    if (m.swapsSinceReset > MAX_SWAPS_LOW_LIQUIDITY) {
      m.circuitBreakerTripped = true
      pool.paused = true
      return true
    }
  }

  if (m.lastInvariant === BigInt(0)) {
    m.lastInvariant = currentInvariant
    return false
  }

  if (currentInvariant < m.lastInvariant) {
    const drift    = m.lastInvariant - currentInvariant
    const driftBps = (drift * BigInt(10000)) / m.lastInvariant
    m.cumulativeDrift += drift
    const cumulBps = (m.cumulativeDrift * BigInt(10000)) / m.lastInvariant

    if (driftBps > DRIFT_BPS_THRESHOLD || cumulBps > CUMULATIVE_DRIFT_BPS) {
      m.circuitBreakerTripped = true
      pool.paused = true
      return true
    }
  }

  m.lastInvariant = currentInvariant
  return false
}

// ── Public API ────────────────────────────────────────────────────────────────

export function stepSwap(): StepResult {
  if (!_state) initSimulation()
  const s = _state!

  let vulnAmountIn = BigInt(0)
  let vulnReverted = false
  try { vulnAmountIn = vulnSwap(BigInt(1)) } catch { vulnReverted = true }

  let protAmountIn = BigInt(0)
  let protReverted = false
  try { protAmountIn = protSwap(BigInt(1)) } catch { protReverted = true }

  const protTripped = protReverted
    ? s.monitor.circuitBreakerTripped
    : monitorCheck()

  s.swapCount++

  return {
    swapIndex: s.swapCount,
    vulnerable: {
      amountIn:  vulnAmountIn.toString(),
      amountOut: vulnReverted ? 0 : 1,
      reserve0:  s.vuln.reserve0.toString(),
      reserve1:  s.vuln.reserve1.toString(),
      invariant: (s.vuln.reserve0 * s.vuln.reserve1).toString(),
      paused:    s.vuln.paused,
      reverted:  vulnReverted,
    },
    protected: {
      amountIn:              protAmountIn.toString(),
      amountOut:             protReverted ? 0 : 1,
      reserve0:              s.prot.reserve0.toString(),
      reserve1:              s.prot.reserve1.toString(),
      invariant:             (s.prot.reserve0 * s.prot.reserve1).toString(),
      paused:                s.prot.paused,
      circuitBreakerTripped: protTripped,
      reverted:              protReverted,
    },
  }
}
