import fs from 'node:fs'
import path from 'node:path'

// Everything DoorVoice keeps lives under data/ (gitignored) so "wipe" is one folder.
export const DATA_DIR = path.join(process.cwd(), 'data')
export const DIRS = {
  frames: path.join(DATA_DIR, 'frames'),
  audio: path.join(DATA_DIR, 'audio'),
  corrections: path.join(DATA_DIR, 'corrections'),
  dataset: path.join(DATA_DIR, 'dataset'),
  fixtures: path.join(DATA_DIR, 'fixtures'),
}

export function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true })
}

const SAFE = /^[A-Za-z0-9._-]+$/

export function saveFile(dir: keyof typeof DIRS, name: string, buf: Buffer) {
  if (!SAFE.test(name)) throw new Error('unsafe file name')
  ensureDirs()
  const p = path.join(DIRS[dir], name)
  fs.writeFileSync(p, buf)
  return p
}

/** Reads a file from one of our folders, refusing any path that escapes it. */
export function readFile(dir: keyof typeof DIRS, name: string): Buffer | null {
  if (!SAFE.test(name)) return null
  const p = path.join(DIRS[dir], name)
  if (!p.startsWith(DIRS[dir]) || !fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

export function removeFile(dir: keyof typeof DIRS, name: string) {
  if (!SAFE.test(name)) return
  fs.rmSync(path.join(DIRS[dir], name), { force: true })
}

export function removeOlderThan(dir: keyof typeof DIRS, cutoffMs: number) {
  if (!fs.existsSync(DIRS[dir])) return 0
  let n = 0
  for (const f of fs.readdirSync(DIRS[dir])) {
    const p = path.join(DIRS[dir], f)
    const st = fs.statSync(p)
    if (st.isFile() && st.mtimeMs < cutoffMs) {
      fs.unlinkSync(p)
      n++
    }
  }
  return n
}

export function wipeDir(dir: keyof typeof DIRS) {
  fs.rmSync(DIRS[dir], { recursive: true, force: true })
  fs.mkdirSync(DIRS[dir], { recursive: true })
}
