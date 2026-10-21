import { NextResponse } from 'next/server'
import { readFile } from '@/lib/server/storage'

export const runtime = 'nodejs'

/** Serves synthesised speech. Files only exist for sentences that passed the guardrails. */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const buf = readFile('audio', name)
  if (!buf) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const type = name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg'
  return new NextResponse(new Uint8Array(buf), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } })
}
