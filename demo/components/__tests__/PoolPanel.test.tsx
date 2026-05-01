import { render, screen } from '@testing-library/react'
import PoolPanel from '../PoolPanel'
import type { PoolState } from '@/lib/types'

const baseState: PoolState = {
  reserve0: 8,
  reserve1: 5,
  invariant: 40,
  paused: false,
  circuitBreakerTripped: false,
  totalExtracted: 3,
  totalPaid: 0,
}

describe('PoolPanel', () => {
  it('renders reserve values', () => {
    render(<PoolPanel variant="vulnerable" state={baseState} />)
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders invariant k', () => {
    render(<PoolPanel variant="vulnerable" state={baseState} />)
    expect(screen.getByText('40')).toBeInTheDocument()
  })

  it('shows exploit banner for vulnerable variant when profit > 0', () => {
    render(<PoolPanel variant="vulnerable" state={baseState} />)
    expect(screen.getByText(/EXPLOIT ACTIVE/i)).toBeInTheDocument()
  })

  it('shows circuit breaker tripped when paused', () => {
    render(
      <PoolPanel
        variant="protected"
        state={{ ...baseState, paused: true, circuitBreakerTripped: true }}
      />
    )
    expect(screen.getByText(/CIRCUIT BREAKER TRIPPED/i)).toBeInTheDocument()
  })

  it('shows protected banner when not tripped', () => {
    render(<PoolPanel variant="protected" state={{ ...baseState, totalExtracted: 0, totalPaid: 0 }} />)
    expect(screen.getByText(/PROTECTED — divUp/i)).toBeInTheDocument()
  })
})
