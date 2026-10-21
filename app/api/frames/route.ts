import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { pushFrame } from '@/lib/server/frame-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The Live screen posts a JPEG from the WHEP video every ~2 s while streaming. Memory only. */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const deviceId = String(form.get('deviceId') ?? '')
  const file = form.get('frame')
  if (!deviceId || !(file instanceof Blob)) return NextResponse.json({ error: 'deviceId and frame required' }, { status: 400 })
  if (file.size > 3_000_000) return NextResponse.json({ error: 'frame too large' }, { status: 413 })
  const buf = Buffer.from(await file.arrayBuffer())
  try {
    await sharp(buf).metadata() // reject anything that is not an image
  } catch {
    return NextResponse.json({ error: 'not an image' }, { status: 400 })
  }
  pushFrame(deviceId, { buf, source: 'live_view', label: 'Live view frame (sandbox WHEP stream)', capturedAt: Date.now() })
  return NextResponse.json({ ok: true })
}
