import { BoundingBox, ProcessorResult, VideoProcessor } from '../types'

/**
 * Accessible Narrator: a cloud-free spoken guide for blind and low-vision viewers.
 *
 * Stage 1 (cheap gate): frame differencing on a 32x18 grid finds where something
 * moved. Nothing is sent anywhere and no model is used.
 * Spatial sentence: the moving region is turned into "Movement on your left, close
 * to the camera." and spoken with the browser's speech synthesis, plus an
 * aria-live region for screen readers.
 *
 * It never describes people, only where movement is. A detector can be plugged in
 * through `setDetector` to replace the motion gate with labelled boxes.
 */

type Detector = (frame: ImageData) => Promise<BoundingBox[]>

const GRID_W = 32
const GRID_H = 18
const CELL_THRESHOLD = 28 // mean absolute luma change per cell (0-255)
const MIN_CELLS = 4 // ignore tiny flickers
const QUIET_MS = 4000 // do not repeat a sentence more often than this

export class AccessibleNarratorProcessor implements VideoProcessor {
  id = 'accessible-narrator'
  name = 'Accessible Narrator'
  description = 'Speaks where movement is (left, centre, right; near or far) for blind and low-vision viewers. Runs fully in the browser.'
  enabled = false

  private prev: Float32Array | null = null
  private lastSpoken = ''
  private lastAt = 0
  private detector: Detector | null = null
  private live: HTMLElement | null = null

  /** Optional: replace the motion gate with any detector that returns boxes. */
  setDetector(d: Detector | null) {
    this.detector = d
  }

  async init() {
    if (typeof document === 'undefined') return
    this.live = document.getElementById('accessible-narrator-live')
    if (!this.live) {
      this.live = document.createElement('div')
      this.live.id = 'accessible-narrator-live'
      this.live.setAttribute('aria-live', 'polite')
      this.live.setAttribute('role', 'status')
      Object.assign(this.live.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' })
      document.body.appendChild(this.live)
    }
  }

  async destroy() {
    this.prev = null
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
  }

  async process(frame: ImageData): Promise<ProcessorResult | null> {
    const boxes = this.detector ? await this.detector(frame) : this.motionBoxes(frame)
    if (!boxes.length) return null
    // The biggest region is the one worth talking about.
    const main = boxes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    const sentence = spatialSentence(main, frame.width, frame.height)
    this.say(sentence)
    return {
      id: `narrator-${Date.now()}`,
      processorId: this.id,
      timestamp: Date.now(),
      boundingBoxes: boxes.map((b) => ({ ...b, color: b.color ?? '#FFB86B' })),
      message: sentence,
      data: { regions: boxes.length },
    }
  }

  /** Grid frame differencing; returns one box around the changed cells. */
  private motionBoxes(frame: ImageData): BoundingBox[] {
    const { width, height, data } = frame
    const cw = width / GRID_W
    const ch = height / GRID_H
    const luma = new Float32Array(GRID_W * GRID_H)
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        // Sample the cell centre plus four neighbours: cheap and stable enough.
        let sum = 0
        for (const [dx, dy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const x = Math.min(width - 1, Math.floor((gx + dx) * cw))
          const y = Math.min(height - 1, Math.floor((gy + dy) * ch))
          const i = (y * width + x) * 4
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        }
        luma[gy * GRID_W + gx] = sum / 5
      }
    }
    const prev = this.prev
    this.prev = luma
    if (!prev) return []
    let minX = GRID_W, minY = GRID_H, maxX = -1, maxY = -1, count = 0
    for (let i = 0; i < luma.length; i++) {
      // Skip the top 12% and bottom 6%: Ring's watermark and timestamp change every second.
      const gy = Math.floor(i / GRID_W)
      if (gy < GRID_H * 0.12 || gy >= GRID_H * 0.94) continue
      if (Math.abs(luma[i] - prev[i]) > CELL_THRESHOLD) {
        const gx = i % GRID_W
        minX = Math.min(minX, gx); maxX = Math.max(maxX, gx)
        minY = Math.min(minY, gy); maxY = Math.max(maxY, gy)
        count++
      }
    }
    if (count < MIN_CELLS) return []
    return [{ x: minX * cw, y: minY * ch, width: (maxX - minX + 1) * cw, height: (maxY - minY + 1) * ch, label: 'movement', confidence: Math.min(1, count / 40) }]
  }

  private say(sentence: string) {
    const now = Date.now()
    if (sentence === this.lastSpoken && now - this.lastAt < QUIET_MS * 3) return
    if (now - this.lastAt < QUIET_MS) return
    this.lastSpoken = sentence
    this.lastAt = now
    if (this.live) this.live.textContent = sentence
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(sentence))
    }
  }
}

/** Left/centre/right from the box centre; near/far from how much of the frame it fills. */
export function spatialSentence(b: BoundingBox, frameW: number, frameH: number): string {
  const cx = (b.x + b.width / 2) / frameW
  const side = cx < 0.38 ? 'on your left' : cx > 0.62 ? 'on your right' : 'straight ahead'
  const area = (b.width * b.height) / (frameW * frameH)
  const bottom = (b.y + b.height) / frameH
  const distance = area > 0.15 || bottom > 0.85 ? 'close to the camera' : 'further away'
  const what = b.label && b.label !== 'movement' ? `${b.label.charAt(0).toUpperCase()}${b.label.slice(1)}` : 'Movement'
  return `${what} ${side}, ${distance}.`
}

export const accessibleNarratorProcessor = new AccessibleNarratorProcessor()
