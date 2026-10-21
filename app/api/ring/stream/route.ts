import { NextRequest, NextResponse } from 'next/server'
import { startWhep, stopWhep } from '@/lib/ring/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// WHEP signalling proxy (adapted from AmazonAppDev/ring-api-helloworld). The browser
// sends its SDP offer here; only the server talks to Ring with the token.

export async function POST(req: NextRequest) {
  try {
    const { sdpOffer, deviceId } = await req.json()
    if (!sdpOffer || !deviceId) return NextResponse.json({ error: 'sdpOffer and deviceId are required' }, { status: 400 })
    return NextResponse.json(await startWhep(deviceId, sdpOffer))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { sessionUrl } = await req.json()
    if (sessionUrl) await stopWhep(sessionUrl)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 })
  }
}
