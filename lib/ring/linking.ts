import crypto from 'node:crypto'
import { config } from '../config'

// One-way account linking (authentication/account_linking.md):
// Ring redirects with ?nonce=<b64url HMAC-SHA256(key, "<time_ms>:<account_id>")>&time=<ms>.
// The partner signs the user in, matches the nonce to an unclaimed token, then
// POSTs and PATCHes /v1/accounts/me/app-integrations. Same key as webhooks,
// different encoding (base64url without padding, not hex).

export const NONCE_WINDOW_MS = 600_000

export function computeNonce(timeMs: number | string, accountId: string, key = config().RING_HMAC_KEY): string {
  return crypto.createHmac('sha256', Buffer.from(key, 'utf-8')).update(`${timeMs}:${accountId}`, 'utf-8').digest('base64url')
}

export function nonceFresh(timeMs: number, now = Date.now()) {
  return Number.isFinite(timeMs) && timeMs <= now + 30_000 && now - timeMs <= NONCE_WINDOW_MS
}

export function nonceMatches(nonce: string, timeMs: number | string, accountId: string, key?: string): boolean {
  const expected = Buffer.from(computeNonce(timeMs, accountId, key))
  const got = Buffer.from(nonce)
  return expected.length === got.length && crypto.timingSafeEqual(expected, got)
}

export interface UnclaimedToken {
  accountId: string
  accessToken: string
}

/** Finds which unclaimed token the redirect belongs to. Constant-time per candidate. */
export function matchUnclaimed(nonce: string, timeMs: number, pool: UnclaimedToken[], now = Date.now()): UnclaimedToken | null {
  if (!nonceFresh(timeMs, now)) return null
  return pool.find((t) => nonceMatches(nonce, timeMs, t.accountId)) ?? null
}

/** Masks a partner email for the account_identifier Ring shows the user: "k***2@gmail.com". */
export function maskIdentifier(email: string) {
  const [user, domain] = email.split('@')
  if (!domain) return `${email.slice(0, 1)}***`
  return `${user.slice(0, 1)}***${user.length > 1 ? user.slice(-1) : ''}@${domain}`
}

async function appIntegrations(method: 'POST' | 'PATCH', accessToken: string, body: unknown) {
  const res = await fetch(`${config().RING_API_BASE}/v1/accounts/me/app-integrations`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`app-integrations ${method} ${res.status}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

/** POST (nonce -> awaiting) then the mandatory PATCH (-> completed). */
export async function completeAccountLink(token: UnclaimedToken, nonce: string, partnerEmail: string) {
  const account_identifier = maskIdentifier(partnerEmail)
  const confirmed = await appIntegrations('POST', token.accessToken, { account_identifier, nonce })
  const completed = await appIntegrations('PATCH', token.accessToken, { account_identifier, status: 'completed' })
  return { confirmed, completed }
}
