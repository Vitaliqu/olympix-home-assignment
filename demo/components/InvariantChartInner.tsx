'use client'

import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts'
import type { ChartPoint } from '@/lib/types'

interface Props {
  data: ChartPoint[]
  tripSwapIndex?: number | null
}

// Colorblind-safe palette:
//   Vulnerable — #ef4444 (red/danger), solid line
//   Protected  — #22d3ee (cyan/data), dashed line
// Both hue pairs AND line style differentiate the series; color alone is never load-bearing.
const VULN_COLOR = '#ef4444'
const PROT_COLOR = '#22d3ee'

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ dataKey: string; color: string; name: string; value: number }>
  label?: number
}) => {
  if (!active || !payload?.length) return null
  return (
    <div
      className="border border-base-border rounded-lg px-3 py-2.5 text-xs shadow-xl font-mono"
      style={{ background: 'rgba(8,15,30,0.97)', backdropFilter: 'blur(8px)' }}
    >
      <p className="text-slate-500 mb-2">
        swap <span className="text-slate-300">#{label}</span>
      </p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 mb-0.5">
          <div className="flex items-center gap-1.5">
            {/* Shape indicator matches legend: circle for vulnerable, dash for protected */}
            {p.dataKey === 'vulnerableK' ? (
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
            ) : (
              <span
                className="w-4 flex-shrink-0 border-t-2 border-dashed"
                style={{ borderColor: p.color }}
              />
            )}
            <span className="text-slate-500">{p.name}</span>
          </div>
          <span className="font-bold tabular-nums" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

const TrippedLabel = ({ viewBox }: { viewBox?: { x?: number; y?: number } }) => {
  const { x, y } = viewBox ?? {}
  if (x == null) return null
  return (
    <g>
      <text
        x={x + 6}
        y={(y ?? 20) + 14}
        fill="#f59e0b"
        fontSize={9}
        fontFamily="JetBrains Mono, monospace"
      >
        ⚡ breaker tripped
      </text>
    </g>
  )
}

export default function InvariantChartInner({ data, tripSwapIndex }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id="gradVuln" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VULN_COLOR} stopOpacity={0.22} />
            <stop offset="95%" stopColor={VULN_COLOR} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradProt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PROT_COLOR} stopOpacity={0.12} />
            <stop offset="95%" stopColor={PROT_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="2 4" stroke="#1a2540" vertical={false} />

        <XAxis
          dataKey="swap"
          tick={{ fill: '#334155', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
          axisLine={{ stroke: '#1a2540' }}
          tickLine={false}
          label={{
            value: 'swap #',
            position: 'insideBottomRight',
            offset: -4,
            fill: '#334155',
            fontSize: 9,
            fontFamily: 'JetBrains Mono, monospace',
          }}
        />
        <YAxis
          tick={{ fill: '#334155', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
          axisLine={false}
          tickLine={false}
          width={32}
        />

        <Tooltip content={<CustomTooltip />} />

        {tripSwapIndex != null && (
          <ReferenceLine
            x={tripSwapIndex}
            stroke="#f59e0b"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={<TrippedLabel />}
          />
        )}

        {/* Area fills behind lines */}
        <Area
          type="monotone"
          dataKey="vulnerableK"
          stroke="none"
          fill="url(#gradVuln)"
          isAnimationActive={false}
          name="Vulnerable k"
        />
        <Area
          type="monotone"
          dataKey="protectedK"
          stroke="none"
          fill="url(#gradProt)"
          isAnimationActive={false}
          name="Protected k"
        />

        {/* Vulnerable — solid red line, circle activeDot */}
        <Line
          type="monotone"
          dataKey="vulnerableK"
          stroke={VULN_COLOR}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          name="Vulnerable k"
          activeDot={{ r: 4, fill: VULN_COLOR, strokeWidth: 0 }}
        />

        {/* Protected — dashed cyan line, square activeDot for shape differentiation */}
        <Line
          type="monotone"
          dataKey="protectedK"
          stroke={PROT_COLOR}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          isAnimationActive={false}
          name="Protected k"
          activeDot={{ r: 4, fill: PROT_COLOR, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
