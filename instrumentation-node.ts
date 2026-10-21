// Fail fast on a broken .env, then start the retention and nightly dataset-export timers.
import { configWarnings, loadConfig } from './lib/config'
import { startMaintenance } from './lib/server/maintenance'
import { ensureDirs } from './lib/server/storage'

try {
  loadConfig()
} catch (e) {
  console.error(`\n${(e as Error).message}\n`)
  process.exit(1)
}
ensureDirs()
startMaintenance()
for (const w of configWarnings()) console.warn(`[doorvoice] ${w}`)
console.log('[doorvoice] ready: open http://localhost:3000')
