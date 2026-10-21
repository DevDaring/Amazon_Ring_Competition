import { NextResponse } from 'next/server'
import { RingNotConnected } from '@/lib/ring/auth'
import { RingApiError } from '@/lib/ring/client'
import { getDevices } from '@/lib/server/devices'
import { cameraName, getSettings } from '@/lib/server/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get('refresh') === '1'
    const [devices, settings] = await Promise.all([getDevices(force), getSettings()])
    return NextResponse.json({
      devices: devices.map((d) => ({ ...d, displayName: cameraName(settings, d.id, d.name), kind: settings.cameras[d.id]?.kind ?? 'outdoor' })),
    })
  } catch (e) {
    const status = e instanceof RingNotConnected ? 401 : e instanceof RingApiError ? e.status : 500
    return NextResponse.json({ devices: [], error: (e as Error).message }, { status })
  }
}
