import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { getAccessToken } from '@/lib/ring/auth'
import { getUserAccountId } from '@/lib/ring/client'
import { completeAccountLink, matchUnclaimed, nonceFresh, UnclaimedToken } from '@/lib/ring/linking'
import { claimLink, unclaimedLinks } from '@/lib/ring/tokens'
import { clearDeviceCache } from '@/lib/server/devices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One-way account linking. Ring sends the user to /link?nonce=..&time=..; that page sits
 * behind DoorVoice's sign-in (the mandatory partner sign-in), so only a signed-in user
 * reaches this call. We match the nonce against the unclaimed tokens received at the
 * Token Exchange URL, then POST and PATCH /v1/accounts/me/app-integrations.
 */
export async function POST(req: NextRequest) {
  const { nonce, time, email } = await req.json().catch(() => ({}))
  const t = Number(time)
  if (!nonce || !email || !Number.isFinite(t)) return NextResponse.json({ error: 'nonce, time and your email are required' }, { status: 400 })
  if (!nonceFresh(t)) return NextResponse.json({ error: 'This link request is older than 10 minutes. Start again from the Ring app.' }, { status: 400 })
  try {
    const links = await unclaimedLinks()
    const pool: Array<UnclaimedToken & { linkId?: string }> = links.map((l) => ({ accountId: l.accountId, accessToken: l.accessToken, linkId: l.id }))
    // Sandbox fallback: the Playground token's own account, for testing without the Appstore.
    if (!pool.length) {
      const accessToken = await getAccessToken()
      pool.push({ accountId: await getUserAccountId(), accessToken })
    }
    const token = matchUnclaimed(nonce, t, pool) as (UnclaimedToken & { linkId?: string }) | null
    if (!token) return NextResponse.json({ error: 'This link does not match any Ring account waiting to be linked.' }, { status: 400 })
    const result = await completeAccountLink(token, nonce, email)
    if (token.linkId) await claimLink(token.linkId, email)
    clearDeviceCache()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}

/** DEMO_MODE helper: valid nonce parameters for the current token's account, for testing /link. */
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
