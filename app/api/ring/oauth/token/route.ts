import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/ring/tokens'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Token Exchange URL. When a Ring user installs DoorVoice, Ring's backend POSTs an
 * OAuth authorization code here (application/x-www-form-urlencoded). We exchange it
 * at oauth.ring.com within its 60-second life and store the tokens as unclaimed; the
 * user then signs in on /link to claim them.
 */
export async function POST(req: NextRequest) {
  let code = ''
  try {
    const form = await req.formData()
    code = String(form.get('code') ?? '')
  } catch {
    // Some clients send JSON; accept it too.
    code = String((await req.json().catch(() => ({})))?.code ?? '')
  }
  if (!code) return NextResponse.json({ error: 'missing code' }, { status: 400 })
  try {
    const accountId = await exchangeCode(code)
    console.log(`[token-exchange] stored unclaimed tokens for account …${accountId.slice(-6)}`)
    return NextResponse.json({ status: 'ok' })
  } catch (e) {
    console.error('[token-exchange]', (e as Error).message)
    // 5xx so Ring can retry while the code is still valid.
    return NextResponse.json({ error: 'token exchange failed' }, { status: 502 })
  }
}
