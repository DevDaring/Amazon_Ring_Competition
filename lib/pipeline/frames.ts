// Frame quality scoring implements the variance-of-Laplacian focus measure from
// Pech-Pacheco et al., "Diatom autofocusing in brightfield microscopy: a comparative
// study", ICPR 2000. Low variance = few edges = blurry or empty frame.

import sharp from 'sharp'
import type { Frame } from './types'
import type { Vertex } from '../ring/client'

/**
 * Regions to ignore when scoring, as fractions of width/height. Ring burns a logo into
 * the top-left and a Device-ID/Partner/Generated-At block into the top-right; the
 * sandbox footage also carries its own timestamp bar along the bottom and black
 * pillar bars at the sides. Their hard edges would make every frame look "sharp".
 */
export const WATERMARK_MASKS = [
  { left: 0, top: 0, width: 0.08, height: 0.12 }, // Ring logo
  { left: 0.7, top: 0, width: 0.3, height: 0.12 }, // device / partner / timestamp text
  { left: 0, top: 0.94, width: 1, height: 0.06 }, // burnt-in timestamp bar of the source clip
  { left: 0, top: 0, width: 0.03, height: 1 }, // left pillar
  { left: 0.97, top: 0, width: 0.03, height: 1 }, // right pillar
]

const SCORE_WIDTH = 320

export interface FrameScore {
  sharpness: number
  brightness: number
  width: number
  height: number
}

export async function scoreFrame(buf: Buffer): Promise<FrameScore> {
  const meta = await sharp(buf).metadata()
  const { data, info } = await sharp(buf).resize({ width: SCORE_WIDTH }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const masked = new Uint8Array(w * h)
  for (const m of WATERMARK_MASKS) {
    const x0 = Math.floor(m.left * w)
    const y0 = Math.floor(m.top * h)
    const x1 = Math.min(w, Math.ceil((m.left + m.width) * w))
    const y1 = Math.min(h, Math.ceil((m.top + m.height) * h))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) masked[y * w + x] = 1
  }
  let sum = 0
  let sumSq = 0
  let n = 0
  let bright = 0
  let bn = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (masked[i]) continue
      bright += data[i]
      bn++
      // 4-neighbour Laplacian; skip pixels whose neighbourhood touches a mask.
      if (masked[i - 1] || masked[i + 1] || masked[i - w] || masked[i + w]) continue
      const lap = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  const mean = n ? sum / n : 0
  return {
    sharpness: n ? sumSq / n - mean * mean : 0,
    brightness: bn ? bright / bn : 0,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  }
}

export interface Selection {
  kept: Frame[]
  dropped: Array<{ frame: Frame; reason: string }>
}

/** Drops black, washed-out and blurry frames and keeps the sharpest `k`. */
export async function selectFrames(frames: Frame[], k = 3): Promise<Selection> {
  const scored = await Promise.all(
    frames.map(async (f) => {
      const s = await scoreFrame(f.buf)
      return { ...f, sharpness: s.sharpness, brightness: s.brightness, width: s.width, height: s.height }
    })
  )
  const dropped: Selection['dropped'] = []
  const best = Math.max(0, ...scored.map((f) => f.sharpness ?? 0))
  const ok = scored.filter((f) => {
    if ((f.brightness ?? 0) < 18) dropped.push({ frame: f, reason: `too dark (brightness ${f.brightness?.toFixed(0)})` })
    else if ((f.brightness ?? 0) > 245) dropped.push({ frame: f, reason: 'washed out' })
    else if ((f.sharpness ?? 0) < 15 || (f.sharpness ?? 0) < best * 0.35)
      dropped.push({ frame: f, reason: `blurry (Laplacian variance ${f.sharpness?.toFixed(0)})` })
    else return true
    return false
  })
  ok.sort((a, b) => (b.sharpness ?? 0) - (a.sharpness ?? 0))
  return { kept: ok.slice(0, k), dropped }
}

/**
 * Blacks out the user's Ring privacy zones (normalised polygons from
 * /configurations) before any frame leaves the machine for a model.
 */
export async function applyPrivacyZones(buf: Buffer, zones: Vertex[][]): Promise<Buffer> {
  if (!zones.length) return buf
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  const polys = zones
    .filter((z) => z.length >= 3)
    .map((z) => `<polygon points="${z.map((v) => `${(v.x * w).toFixed(1)},${(v.y * h).toFixed(1)}`).join(' ')}" fill="black"/>`)
    .join('')
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${polys}</svg>`)
  return sharp(buf).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 88 }).toBuffer()
}

/** Small crop around a detection, stored with corrections for the training dataset. */
export async function cropBox(buf: Buffer, box?: { left: number; top: number; width: number; height: number }) {
  if (!box || box.width <= 0 || box.height <= 0) return sharp(buf).resize({ width: 480 }).jpeg({ quality: 80 }).toBuffer()
  const meta = await sharp(buf).metadata()
  const W = meta.width ?? 1
  const H = meta.height ?? 1
  const pad = 0.1
  const left = Math.max(0, Math.floor((box.left - pad * box.width) * W))
  const top = Math.max(0, Math.floor((box.top - pad * box.height) * H))
  const width = Math.min(W - left, Math.ceil(box.width * (1 + 2 * pad) * W))
  const height = Math.min(H - top, Math.ceil(box.height * (1 + 2 * pad) * H))
  return sharp(buf).extract({ left, top, width: Math.max(1, width), height: Math.max(1, height) }).jpeg({ quality: 85 }).toBuffer()
}
