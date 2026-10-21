import { describe, expect, it } from 'vitest'
import { AccessibleNarratorProcessor, spatialSentence } from '@/lib/video-processors/examples/accessible-narrator'

// ImageData is a browser type; the plugin only reads width/height/data.
const frame = (w: number, h: number, paint?: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = paint ? paint(x, y) : 100
      const i = (y * w + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  return { width: w, height: h, data } as unknown as ImageData
}

describe('Accessible Narrator plugin', () => {
  it('turns a box into a spatial sentence', () => {
    expect(spatialSentence({ x: 0, y: 300, width: 200, height: 400 }, 1280, 720)).toBe('Movement on your left, close to the camera.')
    expect(spatialSentence({ x: 1000, y: 100, width: 60, height: 60, label: 'person' }, 1280, 720)).toBe('Person on your right, further away.')
  })

  it('stays silent on a static scene and finds where something moved', async () => {
    const p = new AccessibleNarratorProcessor()
    const W = 320
    const H = 180
    expect(await p.process(frame(W, H))).toBeNull() // first frame: nothing to compare
    expect(await p.process(frame(W, H))).toBeNull() // unchanged
    const moved = frame(W, H, (x, y) => (x > 240 && y > 40 && y < 110 ? 250 : 100))
    const r = await p.process(moved)
    expect(r?.message).toBe('Movement on your right, further away.')
    expect(r?.boundingBoxes?.[0].x).toBeGreaterThan(200)
  })

  it('ignores changes in the watermark strip at the top', async () => {
    const p = new AccessibleNarratorProcessor()
    await p.process(frame(320, 180))
    const clock = frame(320, 180, (x, y) => (y < 15 ? 250 : 100))
    expect(await p.process(clock)).toBeNull()
  })
})
