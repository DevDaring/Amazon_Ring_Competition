import { NextResponse } from 'next/server'
import { funnel } from '@/lib/metrics/funnel'
import { datasetSize } from '@/lib/server/dataset'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ...(await funnel(7)), datasetSize: await datasetSize() })
}
