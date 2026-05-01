// demo/app/api/deploy/route.ts
import { NextResponse } from 'next/server'
import { initSimulation } from '@/lib/simulation'

export async function POST() {
  try {
    initSimulation()
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
