import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { processEvent } from '@/lib/pipeline/run'
import { parseWebhook, verifySignature } from '@/lib/ring/webhook'
import { publish } from '@/lib/server/bus'
import { db } from '@/lib/server/db'
import { takeUpload } from '@/lib/server/pending-uploads'
import { enqueue } from '@/lib/server/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ring webhook receiver. Verify the HMAC on the raw bytes, de-duplicate on
 * meta.request_id, store, enqueue, and answer 200 well inside Ring's 5-second limit.
 * All vision work happens after the response.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const raw = Buffer.from(await req.arrayBuffer())
  if (!verifySignature(raw, req.headers.get('x-signature'), config().RING_HMAC_KEY)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }
  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf-8'))
  } catch {
    return NextResponse.json({ error: 'body is not JSON' }, { status: 400 })
  }
  const parsed = parseWebhook(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const e = parsed.event
  // Our simulator prefixes request_id with "sim-"; it is inside the signed body, so it cannot be forged without the key.
  const simulated = e.requestId.startsWith('sim-')

  try {
    const row = await db.event.create({
      data: {
        requestId: e.requestId,
        ringEventId: e.eventId,
        deviceId: e.deviceId,
        type: e.type,
        subType: e.subType,
        simulated,
        receivedAt: new Date(Math.min(e.timestampMs || Date.now(), Date.now())),
      },
    })
    const uploadName = simulated ? takeUpload(e.requestId) : null
    enqueue(`event ${row.id}`, () => processEvent(row.id, { uploadName }))
    publish({ kind: 'event', event: { id: row.id, type: row.type, subType: row.subType, simulated, receivedAt: row.receivedAt } })
    return NextResponse.json({ status: 'accepted', id: row.id, ack_ms: Date.now() - t0 })
  } catch (err: any) {
    // Unique constraint on requestId: Ring retried a delivery we already have.
    if (err?.code === 'P2002') return NextResponse.json({ status: 'duplicate', request_id: e.requestId })
    console.error('[webhook]', err)
    // 5xx tells Ring to retry with backoff.
    return NextResponse.json({ error: 'temporary failure' }, { status: 500 })
  }
}
