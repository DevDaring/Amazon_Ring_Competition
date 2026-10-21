// End-to-end smoke test against the real Ring sandbox in a real browser (Edge/Chrome):
// starts the WHEP live view on /live, checks video frames decode, then sends a
// simulated webhook so the pipeline describes a live-view frame, and asks two questions.
// Needs a valid Playground token in .env or Settings and a running server.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://localhost:3000'
const out = path.join(process.cwd(), 'data', 'smoke')
fs.mkdirSync(out, { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

let browser
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
    break
  } catch {}
}
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage()
page.on('console', (m) => m.type() === 'error' && log('console error:', m.text().slice(0, 200)))

await page.goto(`${base}/live`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'Start live view' }).waitFor({ timeout: 20000 })
await page.waitForFunction(() => !document.querySelector('button[disabled]')?.textContent?.includes('No camera'), null, { timeout: 15000 }).catch(() => {})
const t0 = Date.now()
await page.getByRole('button', { name: 'Start live view' }).click()
log('clicked Start live view')
const ok = await page
  .waitForFunction(() => {
    const v = document.querySelector('video')
    return v && v.videoWidth > 0 && v.currentTime > 0.5
  }, null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false)
const info = await page.evaluate(() => {
  const v = document.querySelector('video')
  return { width: v?.videoWidth, height: v?.videoHeight, time: v?.currentTime, alert: document.querySelector('[role=alert]')?.textContent }
})
log(`video playing: ${ok} after ${Date.now() - t0} ms`, info)
await page.screenshot({ path: path.join(out, 'live.png') })
if (!ok) {
  await browser.close()
  process.exit(1)
}

// Let the page post a few live frames, then fire an event and two questions.
await page.waitForTimeout(5000)
const deviceId = (await (await fetch(`${base}/api/ring/devices`)).json()).devices[0].id
const form = new FormData()
form.append('type', 'motion_detected')
form.append('subType', 'vehicle')
form.append('deviceId', deviceId)
const sim = await (await fetch(`${base}/api/demo/simulate`, { method: 'POST', body: form })).json()
log('simulated webhook ack', sim.response)
await page.waitForTimeout(9000)
const ev = await (await fetch(`${base}/api/events/${sim.response.id}`)).json()
log('event:', ev.status, '|', ev.narration, '|', ev.frameSource, '|', ev.totalMs, 'ms')
for (const s of ev.stages ?? []) log(`   ${s.stage} ${s.status} ${s.latency_ms}ms ${s.model_used ?? ''}`)

for (const q of ['Is the car still there?', 'Describe everything']) {
  const r = await (await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, deviceId }) })).json()
  log(`ask "${q}" -> [${r.intent}] ${r.answer} | frame: ${r.frameSource}`)
}
await page.waitForTimeout(1000)
await page.screenshot({ path: path.join(out, 'live-caption.png') })
await page.getByRole('button', { name: 'Stop live view' }).click().catch(() => {})
await page.waitForTimeout(1500)
await browser.close()
log('screenshots in data/smoke/')
