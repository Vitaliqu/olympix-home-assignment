import { render, screen } from '@testing-library/react'
import InvariantChart from '../InvariantChart'
import type { ChartPoint } from '@/lib/types'

const points: ChartPoint[] = [
  { swap: 0, vulnerableK: 64, protectedK: 64 },
  { swap: 1, vulnerableK: 48, protectedK: 63 },
  { swap: 2, vulnerableK: 28, protectedK: 63 },
]

describe('InvariantChart', () => {
  it('renders the chart container', () => {
    render(<InvariantChart data={points} />)
    expect(screen.getByTestId('invariant-chart')).toBeInTheDocument()
  })

  it('renders with empty data without crashing', () => {
    render(<InvariantChart data={[]} />)
    expect(screen.getByTestId('invariant-chart')).toBeInTheDocument()
  })
})
