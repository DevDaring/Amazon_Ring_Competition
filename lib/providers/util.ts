import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { config } from '../config'

/** Round-robin over comma-separated keys so one exhausted key does not stall a demo. */
const cursors = new Map<string, number>()
export function nextKey(name: string, keys: string[]): string {
  if (!keys.length) throw new Error(`${name}: no API key configured`)
  const i = cursors.get(name) ?? 0
  cursors.set(name, (i + 1) % keys.length)
  return keys[i % keys.length]
}

/**
 * Providers that fail with a permission or billing error are parked for a while so
 * every event does not pay their timeout again. Transient errors are not parked.
 */
const gp = globalThis as unknown as { __doorvoiceParked?: Map<string, { until: number; reason: string }> }
const parked = (gp.__doorvoiceParked ??= new Map())
export function park(id: string, reason: string, ms = 10 * 60_000) {
  parked.set(id, { until: Date.now() + ms, reason })
}
export function isParked(id: string) {
  const p = parked.get(id)
  if (!p) return false
  if (Date.now() > p.until) {
    parked.delete(id)
    return false
  }
  return true
}
export function parkedProviders() {
  return Array.from(parked.entries())
    .filter(([, p]) => Date.now() < p.until)
    .map(([id, p]) => ({ id, reason: p.reason, until: new Date(p.until).toISOString() }))
}

export function isPermanentError(err: unknown): boolean {
  const e = err as any
  const name = e?.name || ''
  const status = e?.$metadata?.httpStatusCode || e?.status
  return (
    /AccessDenied|Unauthorized|UnrecognizedClient|InvalidSignature|ResourceNotFound|ValidationException/i.test(name) ||
    status === 401 ||
    status === 402 ||
    status === 403
  )
}

/**
 * The project owner's rule: every answer served through OpenRouter is an incident
 * (it means AWS failed) and must raise a desktop alert at once. Never throws.
 */
const lastToast = new Map<string, number>()
export function fallbackAlert(rec: { agent: string; primary: string; used: string; reason: string }) {
  try {
    const file = config().FALLBACK_ALERT_LOG || path.join(os.homedir(), '.claude', 'openrouter_fallback_alerts.log')
    const line = {
      // Local wall-clock time, same format as the Python notifier, so the shared log reads consistently.
      ts: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 19),
      project: 'DoorVoice',
      ...rec,
      reason: rec.reason.slice(-300),
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(line) + '\n', 'utf-8')
    console.warn(`[fallback-alert] ${rec.agent}: ${rec.primary} -> ${rec.used} (${rec.reason.slice(0, 120)})`)
    const key = `${rec.agent}|${rec.used}`
    if (process.platform === 'win32' && Date.now() - (lastToast.get(key) ?? 0) > 300_000) {
      lastToast.set(key, Date.now())
      const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$x = $t.GetElementsByTagName('text')
$x.Item(0).AppendChild($t.CreateTextNode($env:FA_TITLE)) > $null
$x.Item(1).AppendChild($t.CreateTextNode($env:FA_BODY)) > $null
$n = [Windows.UI.Notifications.ToastNotification]::new($t)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)`
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        env: { ...process.env, FA_TITLE: 'OpenRouter fallback: DoorVoice', FA_BODY: `${rec.agent}: ${rec.primary} -> ${rec.used}. ${rec.reason.slice(0, 120)}` },
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      })
      child.on('error', () => {})
      child.unref()
    }
  } catch {
    // An alert must never break the pipeline.
  }
}

/** Extracts the JSON object from a model reply. Code fences are tolerated; prose is not. */
export function extractJson(text: string): string {
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  return t
}

// Prices in USD per million tokens (input, output), as listed by each provider in Oct 2026.
const TOKEN_PRICES: Array<[RegExp, number, number]> = [
  [/nova-micro/, 0.035, 0.14],
  [/nova-lite/, 0.06, 0.24],
  [/nova-pro/, 0.8, 3.2],
  [/claude-sonnet|claude-3-7-sonnet|sonnet/, 3, 15],
  [/claude-haiku|haiku/, 1, 5],
  [/gemini-2\.5-flash/, 0.3, 2.5],
  [/gpt-4o-mini/, 0.15, 0.6],
]
export function tokenCost(model: string, inTok: number, outTok: number) {
  const row = TOKEN_PRICES.find(([re]) => re.test(model))
  if (!row) return 0
  return (inTok * row[1] + outTok * row[2]) / 1e6
}

export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now()
  const v = await fn()
  return [v, Date.now() - t0]
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}
