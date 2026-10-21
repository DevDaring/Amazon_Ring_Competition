import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ caregivers: await db.caregiver.findMany({ orderBy: { createdAt: 'desc' } }) })
}

/** Links a caregiver: they get a private, text-only digest link. No video is ever shared. */
export async function POST(req: NextRequest) {
  const { label } = await req.json().catch(() => ({}))
  const c = await db.caregiver.create({
    data: { label: String(label || 'Family member').slice(0, 40), shareToken: crypto.randomBytes(18).toString('base64url') },
  })
  return NextResponse.json({ caregiver: c })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id) await db.caregiver.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
