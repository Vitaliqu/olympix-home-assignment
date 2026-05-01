import { render, screen, fireEvent } from '@testing-library/react'
import AttackControls from '../AttackControls'
import type { DemoMode } from '@/lib/types'

const defaultProps = {
  mode: 'auto' as DemoMode,
  onModeChange: jest.fn(),
  onRun: jest.fn(),
  onReset: jest.fn(),
  onSpeedChange: jest.fn(),
  speed: 6,
  isRunning: false,
  simReady: true,
}

describe('AttackControls', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows Run Attack button when not running', () => {
    render(<AttackControls {...defaultProps} />)
    expect(screen.getByText(/Run Attack/i)).toBeInTheDocument()
  })

  it('shows Pause button when running', () => {
    render(<AttackControls {...defaultProps} isRunning={true} />)
    expect(screen.getByText(/Pause/i)).toBeInTheDocument()
  })

  it('shows speed slider in auto mode', () => {
    render(<AttackControls {...defaultProps} mode="auto" />)
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('hides speed slider in step mode', () => {
    render(<AttackControls {...defaultProps} mode="step" />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('calls onRun when Run Attack clicked', () => {
    render(<AttackControls {...defaultProps} />)
    fireEvent.click(screen.getByText(/Run Attack/i))
    expect(defaultProps.onRun).toHaveBeenCalledTimes(1)
  })

  it('calls onReset when Reset clicked', () => {
    render(<AttackControls {...defaultProps} />)
    fireEvent.click(screen.getByText(/Reset/i))
    expect(defaultProps.onReset).toHaveBeenCalledTimes(1)
  })

  it('shows red dot when simulation unavailable', () => {
    render(<AttackControls {...defaultProps} simReady={false} />)
    expect(screen.getByText(/Simulation unavailable/i)).toBeInTheDocument()
  })
})
