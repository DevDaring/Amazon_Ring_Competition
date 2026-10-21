import { NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { readFile } from '@/lib/server/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The selected frame (privacy zones already blacked out), for low-vision users and the Why panel. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const e = await db.event.findUnique({ where: { id }, select: { framePath: true } })
  const buf = e?.framePath ? readFile('frames', e.framePath) : null
  if (!buf) return NextResponse.json({ error: 'no frame' }, { status: 404 })
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } })
}
