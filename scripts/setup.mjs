// Runs before `npm run dev` / `npm run build`: makes sure .env exists and the SQLite
// schema is applied, so a fresh clone works with one command.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const env = path.join(root, '.env')

if (!fs.existsSync(env)) {
  console.error('\n.env not found. Run:  cp .env.example .env  and fill in the Ring and AWS keys.\n')
  process.exit(1)
}
fs.mkdirSync(path.join(root, 'data'), { recursive: true })
try {
  execSync('npx prisma db push --skip-generate', { cwd: root, stdio: 'pipe' })
  console.log('[setup] database schema is up to date (data/doorvoice.db)')
} catch (e) {
  console.error('[setup] prisma db push failed:\n', e.stdout?.toString() || e.message)
  process.exit(1)
}
