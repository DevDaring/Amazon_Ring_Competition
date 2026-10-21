import { NextRequest, NextResponse } from 'next/server'
import { authStatus, clearRuntimeToken, setRuntimeToken, tokenExpiry } from '@/lib/ring/auth'
import { clearDeviceCache, getDevices } from '@/lib/server/devices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Token status only. The token itself is never sent to the browser. */
export async function GET() {
  return NextResponse.json(authStatus())
}

/** Paste a fresh Developer Playground token (they last ~30 minutes). */
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: '' }))
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return NextResponse.json({ error: 'That does not look like a Ring access token (expected a JWT).' }, { status: 400 })
  }
  const exp = tokenExpiry(token)
  if (exp && exp < Date.now()) return NextResponse.json({ error: 'That token has already expired.' }, { status: 400 })
  setRuntimeToken(token)
  clearDeviceCache()
  try {
    const devices = await getDevices(true)
    return NextResponse.json({ ok: true, ...authStatus(), devices: devices.length })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, ...authStatus() }, { status: 400 })
  }
}

export async function DELETE() {
  clearRuntimeToken()
  clearDeviceCache()
  return NextResponse.json(authStatus())
}
