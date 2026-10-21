import { NextRequest, NextResponse } from 'next/server'
import { cropBox } from '@/lib/pipeline/frames'
import { publish } from '@/lib/server/bus'
import { db } from '@/lib/server/db'
import { datasetSize } from '@/lib/server/dataset'
import { getSettings, updateSettings } from '@/lib/server/settings'
import { readFile, saveFile } from '@/lib/server/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Correct / Wrong / Mute this type. Stores the crop, the model output and the user's
 * label (source: user_feedback). Stage 2 reads corrections on the very next event.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { verdict, userLabel } = await req.json().catch(() => ({}))
  if (!['correct', 'wrong', 'mute'].includes(verdict)) return NextResponse.json({ error: 'verdict must be correct, wrong or mute' }, { status: 400 })
  const e = await db.event.findUnique({ where: { id } })
  if (!e) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const s2 = e.stage2Json ? JSON.parse(e.stage2Json) : {}
  const s1 = e.stage1Json ? JSON.parse(e.stage1Json) : null
  const category: string = s2.dominant && s2.dominant !== 'none' ? s2.dominant : e.subType ?? e.type

  let cropPath: string | null = null
  const frame = e.framePath ? readFile('frames', e.framePath) : null
  if (frame) {
    const box = s1?.detections?.find((d: any) => d.category === category)?.box
    cropPath = `${id}-${Date.now()}.jpg`
    saveFile('corrections', cropPath, await cropBox(frame, box))
  }
  await db.correction.create({
    data: {
      eventId: id,
      verdict,
      userLabel: typeof userLabel === 'string' ? userLabel.slice(0, 80) : null,
      objectType: category,
      cameraName: e.cameraName,
      cropPath,
      modelOutput: e.descriptionJson,
      source: 'user_feedback',
    },
  })
  await db.event.update({ where: { id }, data: { feedback: verdict } })

  if (verdict === 'mute') {
    const settings = await getSettings()
    if (!settings.mutes.some((m) => m.deviceId === (e.deviceId ?? '*') && m.category === category))
      await updateSettings({ mutes: [...settings.mutes, { deviceId: e.deviceId ?? '*', category, at: new Date().toISOString() }] })
  }
  publish({ kind: 'metrics' })
  return NextResponse.json({ ok: true, category, datasetSize: await datasetSize() })
}
