import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { config } from '@/lib/config'
import { buildSimulatedPayload, signBody } from '@/lib/ring/webhook'
import { attachUpload } from '@/lib/server/pending-uploads'
import { getSettings } from '@/lib/server/settings'
import { saveFile } from '@/lib/server/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DEMO_MODE only. Builds a v1.1 Ring payload, signs it with RING_HMAC_KEY exactly as
 * Ring does, and POSTs it to our own /api/ring/webhook, so the real verification,
 * idempotency, queue and pipeline all run. The UI labels these "Simulated webhook".
 */
export async function POST(req: NextRequest) {
  if (!config().DEMO_MODE) return NextResponse.json({ error: 'DEMO_MODE is off' }, { status: 404 })
  const form = await req.formData()
  const type = String(form.get('type') ?? 'motion_detected')
  const subType = (form.get('subType') as string) || undefined
  const settings = await getSettings()
  const deviceId = String(form.get('deviceId') || settings.selectedDeviceId || 'simulated-device')
  const payload = buildSimulatedPayload({ type, subType: type === 'motion_detected' ? subType : undefined, deviceId })

  const image = form.get('image')
  if (image instanceof Blob && image.size > 0) {
    if (image.size > 8_000_000) return NextResponse.json({ error: 'image too large' }, { status: 413 })
    const jpeg = await sharp(Buffer.from(await image.arrayBuffer())).rotate().resize({ width: 1920, height: 1080, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer()
    const name = `upload-${crypto.randomUUID()}.jpg`
    saveFile('frames', name, jpeg)
    attachUpload(payload.meta.request_id, name)
  }

  const raw = JSON.stringify(payload)
  const t0 = Date.now()
  // Straight to this server's own port: behind a proxy, nextUrl.origin is the public
  // https:// address, which the app itself does not serve (it speaks plain HTTP).
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`
  const res = await fetch(`${origin}/api/ring/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': signBody(raw, config().RING_HMAC_KEY) },
    body: raw,
  })
  const body = await res.json().catch(() => ({}))
  // Replay the same signed request to prove idempotency, if asked.
  let replay: unknown = null
  if (form.get('replay') === '1') {
    const r2 = await fetch(`${origin}/api/ring/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signBody(raw, config().RING_HMAC_KEY) },
      body: raw,
    })
    replay = await r2.json().catch(() => null)
  }
  return NextResponse.json({ simulated: true, status: res.status, ack_ms: Date.now() - t0, response: body, replay, payload })
}
