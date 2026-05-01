// demo/app/api/swap/route.ts
import { NextResponse } from 'next/server'
import { stepSwap } from '@/lib/simulation'

export async function POST() {
  try {
    const result = stepSwap()
    return NextResponse.json(result)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
