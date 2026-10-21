import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { getAccessToken } from '@/lib/ring/auth'
import { getUserAccountId } from '@/lib/ring/client'
import { completeAccountLink, matchUnclaimed, nonceFresh } from '@/lib/ring/linking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One-way account linking. Ring redirects the user to /link?nonce=..&time=..; the
 * /link page makes them sign in (mandatory) and posts here. We match the nonce to an
 * unclaimed token, then POST and PATCH /v1/accounts/me/app-integrations.
 *
 * In this hackathon build the "unclaimed pool" is the single token in .env/Settings,
 * because the sandbox issues one token per Playground session.
 */
export async function POST(req: NextRequest) {
  const { nonce, time, email } = await req.json().catch(() => ({}))
  const t = Number(time)
  if (!nonce || !email || !Number.isFinite(t)) return NextResponse.json({ error: 'nonce, time and a signed-in email are required' }, { status: 400 })
  if (!nonceFresh(t)) return NextResponse.json({ error: 'link request is older than 10 minutes; start again from the Ring app' }, { status: 400 })
  try {
    const accessToken = await getAccessToken()
    const accountId = await getUserAccountId()
    const token = matchUnclaimed(nonce, t, [{ accountId, accessToken }])
    if (!token) return NextResponse.json({ error: 'nonce does not match any unclaimed Ring token' }, { status: 400 })
    const result = await completeAccountLink(token, nonce, email)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

/** DEMO_MODE helper: shows what a valid nonce looks like for the current token's account. */
export async function GET() {
  if (!config().DEMO_MODE) return NextResponse.json({ error: 'demo only' }, { status: 404 })
  try {
    await getAccessToken()
    const accountId = await getUserAccountId()
    const { computeNonce } = await import('@/lib/ring/linking')
    const time = Date.now()
    return NextResponse.json({ time, nonce: computeNonce(time, accountId), note: 'Simulated Ring redirect parameters for testing /link' })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
