import { describe, expect, it } from 'vitest'
import { loadEnvFile } from './helpers'

// Opt-in: hits the real Ring sandbox. Run with RING_LIVE=1 npm test while a Playground token is valid.
const live = process.env.RING_LIVE === '1'

describe.skipIf(!live)('Ring sandbox (live)', () => {
  it('lists devices, reads history and downloads a snapshot', async () => {
    loadEnvFile()
    const ring = await import('@/lib/ring/client')
    const devices = await ring.listDevices()
    expect(devices.length).toBeGreaterThan(0)
    const d = devices[0]
    console.log('device', { name: d.name, online: d.online, power: d.power, e2ee: d.e2ee, snapshot: d.supportsSnapshot })
    const history = await ring.eventHistory(d.id, { maxPages: 1 })
    console.log('history events', history.length, history[0])
    if (history[0]) {
      const img = await ring.downloadImageAt(d.id, history[0].start + 3000)
      console.log('snapshot', img.mime, img.buf.length, img.origin, img.mediaTimestamp)
      expect(img.buf.length).toBeGreaterThan(1000)
    }
    await expect(ring.downloadImageAt(d.id, Date.now() - 2000)).rejects.toMatchObject({ status: 416 })
  }, 60_000)
})
