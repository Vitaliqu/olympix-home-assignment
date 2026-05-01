// demo/app/api/state/route.ts
import { NextResponse } from 'next/server'
import { getSimState } from '@/lib/simulation'

export async function GET() {
  try {
    const state = getSimState()
    if (!state) {
      return NextResponse.json({ connected: true, deployed: false })
    }

    const { vuln, prot, monitor } = state

    return NextResponse.json({
      connected: true,
      deployed: true,
      vulnerable: {
        reserve0:  vuln.reserve0.toString(),
        reserve1:  vuln.reserve1.toString(),
        invariant: (vuln.reserve0 * vuln.reserve1).toString(),
        paused:    vuln.paused,
      },
      protected: {
        reserve0:              prot.reserve0.toString(),
        reserve1:              prot.reserve1.toString(),
        invariant:             (prot.reserve0 * prot.reserve1).toString(),
        paused:                prot.paused,
        circuitBreakerTripped: monitor.circuitBreakerTripped,
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
