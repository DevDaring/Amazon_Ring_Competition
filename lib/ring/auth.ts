import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { linkedAccessToken, linkedAccount } from './tokens'

// Ring tokens never leave the server. A Playground token lasts about 30 minutes, so
// Settings lets the user paste a fresh one without restarting; it is kept in
// data/ (gitignored) and in memory only.

const TOKEN_FILE = path.join(process.cwd(), 'data', 'ring-token.json')

let runtimeToken: string | null = null
let refreshed: { token: string; expiresAt: number } | null = null

function readStored(): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'))
    return typeof v.token === 'string' ? v.token : null
  } catch {
    return null
  }
}

export function setRuntimeToken(token: string) {
  runtimeToken = token.trim()
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true })
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: runtimeToken, savedAt: new Date().toISOString() }))
}

export function clearRuntimeToken() {
  runtimeToken = null
  try {
    fs.unlinkSync(TOKEN_FILE)
  } catch {
    /* already gone */
  }
}

/** Reads `exp` from the JWT body for display only; Ring verifies the signature, not us. */
export function tokenExpiry(token: string): number | null {
  try {
    const body = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'))
    return typeof body.exp === 'number' ? body.exp * 1000 : null
  } catch {
    return null
  }
}

function freshestStaticToken(): { token: string; source: 'settings' | 'env' } | null {
  const candidates: Array<{ token: string; source: 'settings' | 'env' }> = []
  const stored = runtimeToken ?? readStored()
  if (stored) candidates.push({ token: stored, source: 'settings' })
  if (config().RING_SANDBOX_TOKEN) candidates.push({ token: config().RING_SANDBOX_TOKEN, source: 'env' })
  // Prefer whichever token expires last; a pasted token is usually newer than .env.
  candidates.sort((a, b) => (tokenExpiry(b.token) ?? 0) - (tokenExpiry(a.token) ?? 0))
  return candidates[0] ?? null
}

export type AuthMode = 'linked_account' | 'sandbox_token' | 'refresh_token' | 'none'

export async function authStatus() {
  const c = config()
  const linked = await linkedAccount().catch(() => null)
  if (linked) return { mode: 'linked_account' as AuthMode, expiresAt: null, source: 'account linking', claimedBy: linked.claimedBy }
  if (c.RING_REFRESH_TOKEN) return { mode: 'refresh_token' as AuthMode, expiresAt: refreshed?.expiresAt ?? null, source: 'env' }
  const t = freshestStaticToken()
  if (!t) return { mode: 'none' as AuthMode, expiresAt: null, source: null }
  return { mode: 'sandbox_token' as AuthMode, expiresAt: tokenExpiry(t.token), source: t.source }
}

/** Refresh-token grant, as in Ring's authentication/refresh_tokens.md. */
export async function refreshAccessToken(refreshToken: string) {
  const c = config()
  const res = await fetch(`${c.RING_OAUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: c.RING_CLIENT_ID,
      client_secret: c.RING_CLIENT_SECRET,
    }).toString(),
  })
  if (!res.ok) throw new Error(`Ring token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
}

export async function getAccessToken(): Promise<string> {
  const c = config()
  // A Ring account linked through the Ring Appstore flow wins; its token refreshes itself.
  const linked = await linkedAccessToken()
  if (linked) return linked
  if (c.RING_REFRESH_TOKEN) {
    if (refreshed && Date.now() < refreshed.expiresAt) return refreshed.token
    const data = await refreshAccessToken(c.RING_REFRESH_TOKEN)
    refreshed = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 - 60_000 }
    return refreshed.token
  }
  const t = freshestStaticToken()
  if (!t) throw new RingNotConnected('No Ring token. Paste a Developer Playground token in Settings.')
  const exp = tokenExpiry(t.token)
  if (exp && exp < Date.now()) throw new RingNotConnected('The Ring Playground token has expired. Paste a new one in Settings.')
  return t.token
}

export function invalidateRefreshed() {
  refreshed = null
}

export class RingNotConnected extends Error {}
