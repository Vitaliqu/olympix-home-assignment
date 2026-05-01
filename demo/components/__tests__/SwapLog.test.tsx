import { render, screen } from '@testing-library/react'
import SwapLog from '../SwapLog'
import type { SwapLogEntry } from '@/lib/types'

const entries: SwapLogEntry[] = [
  { swapIndex: 1, amountOut: 1, vulnAmountIn: 0, vulnInvariant: 48, protAmountIn: 1, protStatus: 'ok',      roundingLoss: 1 },
  { swapIndex: 2, amountOut: 1, vulnAmountIn: 0, vulnInvariant: 28, protAmountIn: 1, protStatus: 'tripped', roundingLoss: 1 },
  { swapIndex: 3, amountOut: 1, vulnAmountIn: 0, vulnInvariant: 12, protAmountIn: 0, protStatus: 'paused',  roundingLoss: 0 },
]

describe('SwapLog', () => {
  it('renders all entries', () => {
    render(<SwapLog entries={entries} />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows tripped status text', () => {
    render(<SwapLog entries={entries} />)
    expect(screen.getByText(/TRIPPED/i)).toBeInTheDocument()
  })

  it('shows paused status text', () => {
    render(<SwapLog entries={entries} />)
    expect(screen.getByText(/PAUSED/i)).toBeInTheDocument()
  })

  it('renders empty state without crashing', () => {
    render(<SwapLog entries={[]} />)
    expect(screen.getByText(/No swaps yet/i)).toBeInTheDocument()
  })
})
