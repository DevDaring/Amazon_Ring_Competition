import crypto from 'node:crypto'
import { z } from 'zod'

// Ring signs every webhook: X-Signature: sha256=<hex HMAC-SHA256(key as UTF-8, raw body)>.
// The raw bytes must be verified before any JSON parsing (notifications.md).

export function signBody(rawBody: string | Buffer, key: string): string {
  return `sha256=${crypto.createHmac('sha256', Buffer.from(key, 'utf-8')).update(rawBody).digest('hex')}`
}

export function verifySignature(rawBody: string | Buffer, header: string | null, key: string): boolean {
  if (!header) return false
  const expected = Buffer.from(signBody(rawBody, key), 'utf-8')
  const received = Buffer.from(header.startsWith('sha256=') ? header : `sha256=${header}`, 'utf-8')
  return expected.length === received.length && crypto.timingSafeEqual(expected, received)
}

const PayloadSchema = z.object({
  meta: z.object({
    version: z.string().optional(),
    time: z.string().optional(),
    request_id: z.string().min(1),
    account_id: z.string().optional(),
  }),
  data: z.object({
    id: z.string(),
    type: z.string(),
    subType: z.string().optional(),
    attributes: z
      .object({
        source: z.string().optional(),
        source_type: z.string().optional(),
        timestamp: z.union([z.number(), z.string()]).optional(),
        sub_type: z.string().optional(),
        subType: z.string().optional(),
      })
      .passthrough(),
  }).passthrough(),
}).passthrough()

export interface RingEvent {
  requestId: string
  eventId: string
  type: string
  subType: string | null
  deviceId: string | null
  timestampMs: number
  accountId?: string
}

export function parseWebhook(body: unknown): { ok: true; event: RingEvent } | { ok: false; error: string } {
  const r = PayloadSchema.safeParse(body)
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const { meta, data } = r.data
  const a = data.attributes
  // The motion doc puts the subtype at data.subType; other docs and samples use
  // attributes.sub_type. Accept all three spellings.
  const subType = data.subType ?? a.sub_type ?? a.subType ?? null
  const ts = typeof a.timestamp === 'number' ? a.timestamp : a.timestamp ? Date.parse(a.timestamp) : Date.parse(meta.time ?? '')
  return {
    ok: true,
    event: {
      requestId: meta.request_id,
      eventId: data.id,
      type: data.type,
      subType,
      deviceId: a.source_type === 'devices' || !a.source_type ? a.source ?? null : null,
      timestampMs: Number.isFinite(ts) ? ts : Date.now(),
      accountId: meta.account_id,
    },
  }
}

/** Builds a v1.1 payload exactly like Ring's, for the Demo panel's simulated webhook. */
export function buildSimulatedPayload(opts: { type: string; subType?: string; deviceId: string; accountId?: string }) {
  const now = Date.now()
  return {
    meta: {
      version: '1.1',
      time: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      request_id: `sim-${crypto.randomUUID()}`,
      account_id: opts.accountId ?? 'simulated-account',
    },
    data: {
      id: `sim-evt-${crypto.randomUUID()}`,
      type: opts.type,
      ...(opts.subType ? { subType: opts.subType } : {}),
      attributes: { source: opts.deviceId, source_type: 'devices', timestamp: now },
      relationships: { devices: { links: { self: `/v1/devices/${opts.deviceId}` } } },
    },
  }
}
