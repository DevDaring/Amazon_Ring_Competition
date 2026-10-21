// Checks voice commands end to end in a real browser (installed Edge/Chrome).
// Typed commands go through the same /api/ask path as speech; spoken commands are
// fed to the browser's fake microphone from WAV files (argv: settingsWav doorbellWav),
// so the real Transcribe -> command parser -> button press path runs.
// Usage: node scripts/voice-command-check.mjs <go-to-settings.wav> <press-doorbell.wav>
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://localhost:3000'
const [settingsWav, doorbellWav] = process.argv.slice(2)

async function launch(wav) {
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  if (wav) args.push(`--use-file-for-fake-audio-capture=${wav.replace(/\\/g, '/')}`)
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args })
    } catch {}
  }
  throw new Error('No Edge or Chrome found')
}

let b = await launch(null)
let p = await b.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
const typed = async (text) => {
  await p.getByLabel('Type a question or command').fill(text)
  await p.getByRole('button', { name: 'Ask', exact: true }).click()
  await p.waitForTimeout(1500)
  return ((await p.getByText('You said:').locator('..').textContent()) ?? '').replace(/\s+/g, ' ')
}

await p.goto(`${base}/`)
await p.waitForTimeout(2000)
console.log('typed "help" ->', (await typed('help')).slice(0, 160))
await typed('switch to Hindi')
console.log('typed "switch to Hindi" -> हिन्दी pressed:', await p.getByRole('button', { name: 'हिन्दी' }).getAttribute('aria-pressed'))
await typed('English')
console.log('typed "press flying carpet" ->', (await typed('press flying carpet')).slice(0, 110))
await typed('go to timeline')
console.log('typed "go to timeline" -> page:', new URL(p.url()).pathname)
await b.close()

if (settingsWav) {
  b = await launch(settingsWav)
  p = await b.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(`${base}/`)
  await p.waitForTimeout(2000)
  await p.keyboard.press('Alt+V')
  await p.waitForTimeout(8000)
  console.log('spoken "Go to settings" (Alt+V) -> page:', new URL(p.url()).pathname)
  await b.close()
}

if (doorbellWav) {
  b = await launch(doorbellWav)
  p = await b.newPage()
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(`${base}/demo`)
  await p.waitForTimeout(2000)
  const before = (await (await fetch(`${base}/api/events?limit=1`)).json()).events[0]?.id
  await p.keyboard.press('Alt+V')
  await p.waitForTimeout(9000)
  const after = (await (await fetch(`${base}/api/events?limit=1`)).json()).events[0]
  console.log('spoken "Press doorbell press" on Demo -> new event created:', after?.id !== before, '| type:', after?.type, '| simulated:', after?.simulated)
  await b.close()
}
console.log('page errors:', errors.length, errors.slice(0, 2))
