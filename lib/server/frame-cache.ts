import type { Frame } from '../pipeline/types'

// The browser plays the WHEP live view, so it is the one that can see live frames.
// While the Live screen streams, it posts a JPEG every ~2 s; they wait here (memory
// only, a few per camera) for the next event or question.

const MAX_PER_DEVICE = 6
const MAX_AGE_MS = 60_000

const g = globalThis as unknown as { __doorvoiceFrames?: Map<string, Frame[]> }
const cache = (g.__doorvoiceFrames ??= new Map<string, Frame[]>())

export function pushFrame(deviceId: string, frame: Frame) {
  const list = [frame, ...(cache.get(deviceId) ?? [])].slice(0, MAX_PER_DEVICE)
  cache.set(deviceId, list)
}

export function recentFrames(deviceId: string, maxAgeMs = MAX_AGE_MS): Frame[] {
  const now = Date.now()
  return (cache.get(deviceId) ?? []).filter((f) => now - f.capturedAt <= maxAgeMs)
}

export function clearFrames() {
  cache.clear()
}
