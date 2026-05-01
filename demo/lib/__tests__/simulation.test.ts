/**
 * @jest-environment node
 */
import {
  initSimulation,
  resetSimulation,
  stepSwap,
  getSimState,
} from '../simulation'

beforeEach(() => {
  resetSimulation()
})

describe('vulnerable pool (free swap bug)', () => {
  it('charges amountIn=0 for the first swap (mulDown truncates to 0)', () => {
    initSimulation()
    const result = stepSwap()
    expect(result.vulnerable.amountIn).toBe('0')
    expect(result.vulnerable.amountOut).toBe(1)
    expect(result.vulnerable.reverted).toBe(false)
  })

  it('drains reserve1 by 1 each swap', () => {
    initSimulation()
    stepSwap()
    const s = getSimState()!
    expect(s.vuln.reserve1).toBe(64n)
  })

  it('reverts when reserve1 reaches 0', () => {
    initSimulation()
    for (let i = 0; i < 65; i++) stepSwap()
    const result = stepSwap()
    expect(result.vulnerable.reverted).toBe(true)
  })
})

describe('protected pool (ceiling division fix)', () => {
  it('charges amountIn >= 1 for the first swap', () => {
    initSimulation()
    const result = stepSwap()
    expect(BigInt(result.protected.amountIn)).toBeGreaterThanOrEqual(1n)
    expect(result.protected.reverted).toBe(false)
  })

  it('charges amountIn=1 on swap 1 (8*1 / 64 ceil = 1)', () => {
    initSimulation()
    const result = stepSwap()
    expect(result.protected.amountIn).toBe('1')
  })
})

describe('circuit breaker (InvariantMonitor)', () => {
  it('does not trip on first swap', () => {
    initSimulation()
    const result = stepSwap()
    expect(result.protected.circuitBreakerTripped).toBe(false)
  })

  it('trips before reserve1 reaches 0 (low-liquidity guard)', () => {
    initSimulation()
    let tripped = false
    for (let i = 0; i < 65; i++) {
      const r = stepSwap()
      if (r.protected.circuitBreakerTripped) { tripped = true; break }
    }
    expect(tripped).toBe(true)
  })

  it('stays tripped once circuit breaker fires', () => {
    initSimulation()
    for (let i = 0; i < 65; i++) stepSwap()
    stepSwap()
    expect(getSimState()!.monitor.circuitBreakerTripped).toBe(true)
  })
})

describe('stepSwap response shape', () => {
  it('returns correct swapIndex sequence', () => {
    initSimulation()
    const r1 = stepSwap()
    const r2 = stepSwap()
    expect(r1.swapIndex).toBe(1)
    expect(r2.swapIndex).toBe(2)
  })

  it('invariant field equals reserve0 * reserve1 as string', () => {
    initSimulation()
    const r = stepSwap()
    const s = getSimState()!
    expect(r.vulnerable.invariant).toBe((s.vuln.reserve0 * s.vuln.reserve1).toString())
    expect(r.protected.invariant).toBe((s.prot.reserve0 * s.prot.reserve1).toString())
  })
})

describe('resetSimulation', () => {
  it('restores pools to initial state', () => {
    initSimulation()
    stepSwap(); stepSwap(); stepSwap()
    resetSimulation()
    initSimulation()
    const s = getSimState()!
    expect(s.vuln.reserve0).toBe(8n)
    expect(s.vuln.reserve1).toBe(65n)
    expect(s.prot.reserve0).toBe(8n)
    expect(s.prot.reserve1).toBe(65n)
    expect(s.monitor.circuitBreakerTripped).toBe(false)
    expect(s.swapCount).toBe(0)
  })
})
