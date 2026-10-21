import { config } from '../config'
import { getAccessToken, invalidateRefreshed } from './auth'

// Thin, typed wrappers over the Ring (Amazon Vision) API calls DoorVoice makes.
// Endpoint shapes follow the Ring Appstore docs (read via the Ring MCP server).

export class RingApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail: string,
    public requestId?: string
  ) {
    super(`Ring API ${status} ${code}: ${detail}`)
  }
}

async function errorFrom(res: Response): Promise<RingApiError> {
  const text = await res.text()
  try {
    const e = JSON.parse(text).errors?.[0]
    return new RingApiError(res.status, e?.code ?? 'UNKNOWN', e?.detail ?? text.slice(0, 200), e?.id ?? res.headers.get('x-request-id') ?? undefined)
  } catch {
    return new RingApiError(res.status, 'UNKNOWN', text.slice(0, 200), res.headers.get('x-request-id') ?? undefined)
  }
}

export async function ringFetch(pathOrUrl: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await getAccessToken()
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${config().RING_API_BASE}${pathOrUrl}`
  const res = await fetch(url, { ...init, headers: { ...(init.headers as any), Authorization: `Bearer ${token}` } })
  if (res.status === 401 && !retried && config().RING_REFRESH_TOKEN) {
    invalidateRefreshed()
    return ringFetch(pathOrUrl, init, true)
  }
  return res
}

async function ringJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await ringFetch(path, init)
  if (!res.ok) throw await errorFrom(res)
  return res.json()
}

export interface Vertex {
  x: number
  y: number
}

export interface RingDevice {
  id: string
  name: string
  online: boolean
  imageUrl?: string
  power: 'battery' | 'line'
  e2ee: boolean
  privacyZones: Vertex[][]
  motionZones: Vertex[][]
  maxResolution?: number
  location?: { state?: string; country?: string }
  supportsSnapshot: boolean
}

/** GET /v1/devices with the JSON:API includes joined back onto each device. */
export async function listDevices(): Promise<RingDevice[]> {
  const doc = await ringJson('/v1/devices?include=status,capabilities,location,configurations')
  const included = new Map<string, any>((doc.included ?? []).map((r: any) => [`${r.type}:${r.id}`, r.attributes]))
  const rel = (d: any, name: string) => {
    const r = d.relationships?.[name]?.data
    return r ? included.get(`${r.type}:${r.id}`) : undefined
  }
  return (doc.data ?? []).map((d: any) => {
    const status = rel(d, 'status') ?? {}
    const caps = rel(d, 'capabilities') ?? {}
    const conf = rel(d, 'configurations') ?? {}
    const zones = (list: any[] | undefined) =>
      (list ?? []).map((z: any) => (z.vertices ?? []).map((v: any) => ({ x: Number(v.x), y: Number(v.y) })))
    return {
      id: d.id,
      name: d.attributes?.name ?? 'Ring camera',
      online: Boolean(status.online),
      imageUrl: d.attributes?.image_url,
      // Battery cameras report battery_status; line-powered ones return null.
      power: caps.battery_status ? 'battery' : 'line',
      e2ee: Boolean(conf.e2e_encryption?.enabled),
      privacyZones: zones(conf.image_enhancements?.privacy_zones),
      motionZones: zones(conf.motion_detection?.motion_zones),
      maxResolution: caps.video?.max_resolution,
      location: rel(d, 'location'),
      supportsSnapshot: Boolean(caps.image_enhancements?.configurations?.includes('snapshot')),
    } satisfies RingDevice
  })
}

export async function getUserAccountId(): Promise<string> {
  const doc = await ringJson('/v1/users/me')
  return doc.data.id
}

export interface MediaResult {
  buf: Buffer
  mime: string
  mediaTimestamp?: number
  origin?: string
  durationMs?: number
}

/**
 * Media downloads are two-step: POST returns 303 with a pre-signed Location; errors
 * such as 416 MEDIA_NOT_FOUND only appear on the second (GET) step.
 */
async function twoStepDownload(path: string, body: unknown): Promise<MediaResult> {
  const res = await ringFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
  if (res.status !== 303) throw await errorFrom(res)
  const location = res.headers.get('location')
  if (!location) throw new RingApiError(502, 'NO_LOCATION', '303 without Location header')
  const media = await fetch(location)
  if (!media.ok) throw await errorFrom(media)
  return {
    buf: Buffer.from(await media.arrayBuffer()),
    mime: media.headers.get('content-type') ?? 'application/octet-stream',
    mediaTimestamp: Number(media.headers.get('x-media-timestamp')) || undefined,
    origin: media.headers.get('x-media-origin') ?? undefined,
    durationMs: Number(media.headers.get('x-media-duration')) || undefined,
  }
}

export function downloadImageAt(deviceId: string, timestampMs: number) {
  return twoStepDownload(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
    type: 'at_timestamp',
    timestamp: Math.floor(timestampMs),
    image_options: { format: 'jpeg', resolution: { width: 1920, height: 1080 } },
  })
}

export function downloadLatestImage(deviceId: string, startMs: number, endMs?: number) {
  return twoStepDownload(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
    type: 'latest_in_range',
    start_timestamp: Math.floor(startMs),
    ...(endMs ? { end_timestamp: Math.floor(endMs) } : {}),
    image_options: { format: 'jpeg', resolution: { width: 1920, height: 1080 } },
  })
}

export function downloadClip(deviceId: string, timestampMs: number, durationMs = 4000) {
  return twoStepDownload(`/v1/devices/${encodeURIComponent(deviceId)}/media/video/download`, {
    timestamp: Math.floor(timestampMs),
    duration: durationMs,
    video_options: { codec: 'avc', frame_rate: 2 },
    audio_options: { audio_enabled: false },
  })
}

export interface HistoryEvent {
  id: string
  type: string // motion | on_demand | ding (subtype may be dotted, e.g. motion.human)
  start: number
  end: number
  reviewed: boolean
}

/** GET /v1/history/devices/{id}/events, following links.next until `since` or an empty page. */
export async function eventHistory(deviceId: string, opts: { since?: number; eventTypes?: string; maxPages?: number } = {}) {
  const out: HistoryEvent[] = []
  let next: string | null = `/v1/history/devices/${encodeURIComponent(deviceId)}/events${opts.eventTypes ? `?event_types=${opts.eventTypes}` : ''}`
  for (let page = 0; next && page < (opts.maxPages ?? 5); page++) {
    const doc: any = await ringJson(next)
    const data = doc.data ?? []
    // links.next can be present with empty data; stop or we would loop forever.
    if (!data.length) break
    for (const e of data) {
      out.push({
        id: e.id,
        type: e.attributes?.event_type,
        start: e.attributes?.start,
        end: e.attributes?.end,
        reviewed: Boolean(e.attributes?.is_third_party_reviewed),
      })
    }
    if (opts.since && data[data.length - 1].attributes?.start < opts.since) break
    next = doc.links?.next ?? null
  }
  return opts.since ? out.filter((e) => e.start >= opts.since!) : out
}

export async function startWhep(deviceId: string, sdpOffer: string) {
  const res = await ringFetch(`/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: sdpOffer,
  })
  if (!res.ok) throw await errorFrom(res)
  const location = res.headers.get('location')
  return {
    sdpAnswer: await res.text(),
    sessionUrl: location ? new URL(location, config().RING_API_BASE).toString() : null,
  }
}

export async function stopWhep(sessionUrl: string) {
  // Only ever DELETE sessions on Ring's own host; the URL comes from the browser.
  const u = new URL(sessionUrl)
  if (u.origin !== new URL(config().RING_API_BASE).origin) throw new Error('refusing to DELETE a non-Ring session URL')
  await ringFetch(sessionUrl, { method: 'DELETE' })
}
