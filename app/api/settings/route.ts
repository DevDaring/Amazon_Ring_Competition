import { NextRequest, NextResponse } from 'next/server'
import { getSettings, SettingsSchema, updateSettings } from '@/lib/server/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getSettings())
}

export async function PUT(req: NextRequest) {
  const patch = await req.json().catch(() => ({}))
  const parsed = SettingsSchema.partial().safeParse(patch)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join('; ') }, { status: 400 })
  return NextResponse.json(await updateSettings(parsed.data))
}
