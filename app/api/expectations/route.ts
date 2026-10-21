import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { parseExpectations } from '@/lib/server/expectations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Expire anything whose window has passed before listing.
  await db.expectation.updateMany({ where: { status: 'pending', windowEnd: { lt: new Date() } }, data: { status: 'expired' } })
  const items = await db.expectation.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json({ items })
}

/** "I'm expecting a grocery delivery and my sister around 5." */
export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({ text: '' }))
  const input = String(text ?? '').trim().slice(0, 300)
  if (!input) return NextResponse.json({ error: 'Tell me what you are expecting.' }, { status: 400 })
  const { items, parser } = await parseExpectations(input)
  if (!items.length) return NextResponse.json({ error: 'I could not find a delivery, visitor, vehicle or service in that.', parser }, { status: 422 })
  const created = await Promise.all(
    items.map((i) =>
      db.expectation.create({
        data: {
          text: i.text,
          kind: i.kind,
          objectType: i.objectType ?? null,
          vehicleColour: i.vehicleColour ?? null,
          vehicleType: i.vehicleType ?? null,
          windowStart: i.windowStart,
          windowEnd: i.windowEnd,
        },
      })
    )
  )
  return NextResponse.json({ items: created, parser })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.expectation.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
