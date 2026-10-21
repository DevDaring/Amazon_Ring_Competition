import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const parse = (s: string | null | undefined) => {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Everything the "Why did it say that?" panel shows: stages, filters, confidence. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (id.startsWith('qa-')) {
    const qa = await db.qaLog.findUnique({ where: { id } })
    if (!qa) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ kind: 'qa', ...qa, stages: parse(qa.stagesJson) })
  }
  const e = await db.event.findUnique({ where: { id: id.replace(/-early$/, '') }, include: { corrections: true } })
  if (!e) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    kind: 'event',
    id: e.id,
    requestId: e.requestId,
    type: e.type,
    subType: e.subType,
    simulated: e.simulated,
    status: e.status,
    receivedAt: e.receivedAt,
    cameraName: e.cameraName,
    narration: e.narration,
    confidence: e.confidence,
    urgency: e.urgency,
    modelUsed: e.modelUsed,
    guardFired: e.guardFired,
    frameSource: e.frameSource,
    hasFrame: Boolean(e.framePath),
    ttsProvider: e.ttsProvider,
    totalMs: e.totalMs,
    costUsd: e.costUsd,
    feedback: e.feedback,
    stages: parse(e.stagesJson),
    stage1: parse(e.stage1Json),
    stage2: parse(e.stage2Json),
    description: parse(e.descriptionJson),
    guard: parse(e.guardJson),
    corrections: e.corrections.length,
  })
}
