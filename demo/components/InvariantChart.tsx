'use client'

import dynamic from 'next/dynamic'
import type { ChartPoint } from '@/lib/types'

const Chart = dynamic(() => import('./InvariantChartInner'), { ssr: false })

interface Props {
  data: ChartPoint[]
  tripSwapIndex?: number | null
}

export default function InvariantChart({ data, tripSwapIndex }: Props) {
  return (
    <div data-testid="invariant-chart" className="card p-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-data" />
            <h3 className="text-slate-300 text-xs font-bold tracking-wide font-mono">
              Invariant  k = reserve0 × reserve1
            </h3>
          </div>
          <p className="text-slate-600 text-xs mt-1 font-mono">
            Falling k = value leaking out of the pool
          </p>
        </div>

        {/* Legend — shape + line style + color; no single cue is load-bearing */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="flex items-center gap-1.5">
            {/* Solid line = vulnerable */}
            <span className="w-5 h-0.5 rounded inline-block" style={{ background: '#ef4444' }} />
            <span className="text-slate-500">⚠ Vulnerable</span>
          </span>
          <span className="flex items-center gap-1.5">
            {/* Dashed line = protected (colorblind-safe: cyan, not green) */}
            <span
              className="w-5 inline-block border-t-2 border-dashed"
              style={{ borderColor: '#22d3ee' }}
            />
            <span className="text-slate-500">✓ Protected</span>
          </span>
          {tripSwapIndex != null && (
            <span className="flex items-center gap-1.5">
              <span className="w-5 h-px border-t-2 border-dashed border-warn inline-block" />
              <span className="text-warn/70">breaker</span>
            </span>
          )}
        </div>
      </div>

      <Chart data={data} tripSwapIndex={tripSwapIndex} />
    </div>
  )
}
