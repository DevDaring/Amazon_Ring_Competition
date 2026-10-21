import fs from 'node:fs'
import path from 'node:path'
import { RingApiError, downloadClip, downloadImageAt, downloadLatestImage, eventHistory } from '../ring/client'
import { RingNotConnected } from '../ring/auth'
import { recentFrames } from '../server/frame-cache'
import { DIRS, readFile } from '../server/storage'
import { clipToFrames } from './ffmpeg'
import type { Frame } from './types'

export interface Acquired {
  frames: Frame[]
  notes: string[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Gets 1-6 candidate frames for an event, cheapest and most truthful source first.
 * Every frame carries a label; anything not from the live sandbox is marked so.
 */
export async function acquireFrames(opts: {
  deviceId: string | null
  timestampMs: number
  simulated: boolean
  uploadName?: string | null
  preferLive?: boolean
}): Promise<Acquired> {
  const notes: string[] = []
  const frames: Frame[] = []

  // 1. A demo upload attached to a simulated webhook.
  if (opts.uploadName) {
    const buf = readFile('frames', opts.uploadName)
    if (buf) {
      frames.push({ buf, source: 'simulated_upload', label: 'Simulated: image uploaded in the Demo panel', capturedAt: Date.now() })
      return { frames, notes: ['using the uploaded demo image'] }
    }
  }

  // 2. Frames the browser grabbed from the live WHEP stream around the event time.
  if (opts.deviceId) {
    const live = recentFrames(opts.deviceId, opts.preferLive ? 15_000 : 30_000).filter(
      (f) => Math.abs(f.capturedAt - opts.timestampMs) < 30_000
    )
    if (live.length) {
      notes.push(`${live.length} live-view frame(s) from the sandbox stream`)
      return { frames: live, notes }
    }
  }

  if (!opts.deviceId) return { frames, notes: [...notes, 'no device id on the event'] }

  // 3. Ring snapshot at the event time (±10 s tolerance on Ring's side).
  try {
    let img
    try {
      img = await downloadImageAt(opts.deviceId, opts.timestampMs)
    } catch (e) {
      // Recording may lag the event by a second or two (425 / 416); try once more.
      if (e instanceof RingApiError && (e.status === 425 || e.status === 416) && Date.now() - opts.timestampMs < 20_000) {
        await sleep(1500)
        img = await downloadLatestImage(opts.deviceId, opts.timestampMs - 10_000)
      } else throw e
    }
    frames.push({
      buf: img.buf,
      source: 'ring_snapshot',
      label: `Ring snapshot (${img.origin ?? 'recording'}, ${new Date(img.mediaTimestamp ?? opts.timestampMs).toISOString()})`,
      capturedAt: img.mediaTimestamp ?? opts.timestampMs,
    })
    notes.push('Ring image download')
  } catch (e) {
    if (e instanceof RingNotConnected) notes.push(e.message)
    else notes.push(`snapshot failed: ${(e as Error).message}`)
  }

  // 4. No snapshot? A short clip may still have frames. Skipped when the snapshot
  //    worked, because the extra download would cost 2-4 s of the 5 s budget.
  if (!frames.length && !notes.some((n) => /No Ring token|expired/.test(n))) {
    try {
      const clip = await downloadClip(opts.deviceId, opts.timestampMs - 1000, 3000)
      const extra = await clipToFrames(clip.buf, 1, 3)
      extra.forEach((buf, i) =>
        frames.push({ buf, source: 'ring_clip', label: `Ring clip frame ${i + 1}`, capturedAt: (clip.mediaTimestamp ?? opts.timestampMs) + i * 1000 })
      )
      notes.push(`Ring clip: ${extra.length} frames`)
    } catch (e) {
      notes.push(`clip skipped: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  if (frames.length) return { frames, notes }

  // 5. Simulated events with no live media: use the sandbox's own most recent recording.
  if (opts.simulated) {
    try {
      const hist = await eventHistory(opts.deviceId, { maxPages: 1 })
      const last = hist[0]
      if (last) {
        const img = await downloadImageAt(opts.deviceId, Math.min(last.start + 3000, last.end))
        frames.push({
          buf: img.buf,
          source: 'ring_snapshot',
          label: `Sandbox recording from ${new Date(img.mediaTimestamp ?? last.start).toISOString()} (most recent; event is simulated)`,
          capturedAt: img.mediaTimestamp ?? last.start,
        })
        notes.push('used the most recent sandbox recording for a simulated event')
        return { frames, notes }
      }
    } catch (e) {
      notes.push(`sandbox history fallback failed: ${(e as Error).message.slice(0, 120)}`)
    }
    // 6. Offline demo: a snapshot saved earlier from the sandbox, clearly labelled.
    const fixture = firstFixture()
    if (fixture) {
      frames.push({ buf: fixture.buf, source: 'sandbox_fixture', label: `Simulated: saved sandbox snapshot (${fixture.name})`, capturedAt: Date.now() })
      notes.push('Ring unreachable; used a saved sandbox snapshot')
    }
  }
  return { frames, notes }
}

function firstFixture(): { name: string; buf: Buffer } | null {
  try {
    const files = fs.readdirSync(DIRS.fixtures).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()
    if (!files.length) return null
    return { name: files[0], buf: fs.readFileSync(path.join(DIRS.fixtures, files[0])) }
  } catch {
    return null
  }
}
