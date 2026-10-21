import fs from 'node:fs'
import path from 'node:path'

/** Minimal .env loader for opt-in live tests (Next.js loads .env itself at runtime). */
export function loadEnvFile(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
