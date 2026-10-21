import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Timeline: newest first, filterable by type/category/status. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const type = p.get('type')
  const status = p.get('status')
  const limit = Math.min(Number(p.get('limit') ?? 50), 200)
  const rows = await db.event.findMany({
    where: {
      ...(type === 'doorbell' ? { type: 'button_press' } : type === 'motion' ? { type: 'motion_detected' } : type ? { subType: type } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({
    events: rows.map((r) => ({
      id: r.id,
      type: r.type,
      subType: r.subType,
      simulated: r.simulated,
      status: r.status,
      receivedAt: r.receivedAt,
      cameraName: r.cameraName,
      narration: r.narration,
      language: r.language,
      confidence: r.confidence,
      urgency: r.urgency,
      guardFired: r.guardFired,
      feedback: r.feedback,
      audioUrl: r.audioPath,
      hasFrame: Boolean(r.framePath),
      totalMs: r.totalMs,
      costUsd: r.costUsd,
    })),
  })
}
