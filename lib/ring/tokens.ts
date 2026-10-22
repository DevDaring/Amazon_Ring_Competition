import { config } from '../config'
import { db } from '../server/db'

// Token Exchange (architecture/app-deployment.md, section 5): Ring POSTs a one-time
// authorization code to our Token Exchange URL; it must be exchanged within 60 s.
// The tokens are stored "unclaimed" with the Ring account ID until a signed-in user
// completes account linking on /link.

interface OAuthTokens {
  access_token: string
  refresh_token: string
  expires_in: number
}

async function oauthToken(params: Record<string, string>): Promise<OAuthTokens> {
  const c = config()
  const res = await fetch(`${c.RING_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: c.RING_CLIENT_ID, client_secret: c.RING_CLIENT_SECRET }).toString(),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Ring OAuth ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

async function accountIdFor(accessToken: string): Promise<string> {
  const res = await fetch(`${config().RING_API_BASE}/v1/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`users/me ${res.status}`)
  return (await res.json()).data.id
}

/** Exchanges an authorization code and stores the tokens as unclaimed. Returns the account ID. */
export async function exchangeCode(code: string): Promise<string> {
  const t = await oauthToken({ grant_type: 'authorization_code', code })
  const accountId = await accountIdFor(t.access_token)
  const data = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + t.expires_in * 1000 - 60_000),
  }
  // Re-installing replaces the tokens; an already linked account stays linked.
  await db.ringLink.upsert({ where: { accountId }, create: { accountId, ...data }, update: data })
  return accountId
}

export async function unclaimedLinks() {
  return db.ringLink.findMany({ where: { status: 'unclaimed' }, orderBy: { createdAt: 'desc' } })
}

export async function claimLink(id: string, email: string) {
  await db.ringLink.update({ where: { id }, data: { status: 'claimed', claimedBy: email, claimedAt: new Date() } })
}

/** Access token of the linked account, refreshed when it is about to expire. Null if none is linked. */
export async function linkedAccessToken(): Promise<string | null> {
  const link = await db.ringLink.findFirst({ where: { status: 'claimed' }, orderBy: { claimedAt: 'desc' } })
  if (!link) return null
  if (link.expiresAt.getTime() > Date.now()) return link.accessToken
  const t = await oauthToken({ grant_type: 'refresh_token', refresh_token: link.refreshToken })
  await db.ringLink.update({
    where: { id: link.id },
    data: { accessToken: t.access_token, refreshToken: t.refresh_token ?? link.refreshToken, expiresAt: new Date(Date.now() + t.expires_in * 1000 - 60_000) },
  })
  return t.access_token
}

export async function linkedAccount() {
  const link = await db.ringLink.findFirst({ where: { status: 'claimed' }, orderBy: { claimedAt: 'desc' } })
  return link ? { accountId: link.accountId, claimedBy: link.claimedBy, claimedAt: link.claimedAt } : null
}

/** app_integration_removed: Ring revoked the tokens, so forget them. */
export async function forgetAccount(accountId: string) {
  await db.ringLink.deleteMany({ where: { accountId } })
}
