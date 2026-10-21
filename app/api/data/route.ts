import { NextRequest, NextResponse } from 'next/server'
import { datasetSize, exportDataset } from '@/lib/server/dataset'
import { applyRetention, wipeAll } from '@/lib/server/maintenance'
import { publish } from '@/lib/server/bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ datasetSize: await datasetSize() })
}

/** action: export (corrections -> dataset folder / S3), retention (apply now), wipe (one-tap delete). */
export async function POST(req: NextRequest) {
  const { action } = await req.json().catch(() => ({}))
  if (action === 'export') return NextResponse.json(await exportDataset())
  if (action === 'retention') return NextResponse.json(await applyRetention())
  if (action === 'wipe') {
    await wipeAll()
    publish({ kind: 'metrics' })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
