export interface PoolState {
  reserve0: number
  reserve1: number
  invariant: number
  paused: boolean
  circuitBreakerTripped: boolean
  totalExtracted: number
  totalPaid: number
}

export interface SwapLogEntry {
  swapIndex: number
  amountOut: number
  vulnAmountIn: number
  vulnInvariant: number
  protAmountIn: number
  protStatus: 'ok' | 'tripped' | 'paused' | 'drained'
  /** Wei the attacker avoided paying: protAmountIn - vulnAmountIn. Non-zero only on free swaps. */
  roundingLoss: number
}

/** Snapshot of one swap's rounding delta for the tracker chart. */
export interface RoundingDeltaPoint {
  swapIndex: number
  loss: number
  cumulativeLoss: number
}

export interface ChartPoint {
  swap: number
  vulnerableK: number
  protectedK: number
}


export type DemoMode = 'auto' | 'step'
export type DemoPhase = 'idle' | 'running' | 'complete'

// Shape of POST /api/swap response
export interface SwapResult {
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
