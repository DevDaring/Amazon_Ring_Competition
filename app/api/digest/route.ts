import { NextRequest, NextResponse } from 'next/server'
import { LANGUAGES, Language } from '@/lib/pipeline/types'
import { db } from '@/lib/server/db'
import { buildDigest } from '@/lib/server/digest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Digest for the local app, or for a caregiver holding a share token. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const token = p.get('token')
  if (token) {
    const c = await db.caregiver.findUnique({ where: { shareToken: token } })
    if (!c) return NextResponse.json({ error: 'This digest link is no longer valid.' }, { status: 404 })
  }
  const l = p.get('lang')
  const lang = l && LANGUAGES.includes(l as Language) ? (l as Language) : undefined
  const hours = Math.min(Math.max(Number(p.get('hours') ?? 24), 1), 168)
  return NextResponse.json(await buildDigest({ hours, lang }))
}
