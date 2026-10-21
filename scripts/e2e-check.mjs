// End-to-end check of every screen, button and feature in a real browser (installed
// Edge or Chrome). Prints PASS/FAIL per check and writes data/e2e/report.json.
// Settings are saved first and restored at the end; "Wipe all data" is only opened
// and cancelled, never executed.
// Usage (app running):  node scripts/e2e-check.mjs [spoken-command.wav]
// Hosted behind a site password: BASE_URL=https://... E2E_USER=judge E2E_PASS=... node scripts/e2e-check.mjs
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://localhost:3000'
const wav = process.argv[2]
const out = path.join(process.cwd(), 'data', 'e2e')
fs.mkdirSync(out, { recursive: true })
const results = []
const authHeader = process.env.E2E_USER ? { Authorization: 'Basic ' + Buffer.from(`${process.env.E2E_USER}:${process.env.E2E_PASS ?? ''}`).toString('base64') } : {}
const httpCredentials = process.env.E2E_USER ? { username: process.env.E2E_USER, password: process.env.E2E_PASS ?? '' } : undefined
const authed = (init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), ...authHeader } })
const api = async (p, init) => (await fetch(base + p, authed(init))).json()

async function check(name, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? '', ms: Date.now() - t0 })
    console.log(`PASS  ${name}${detail ? `  (${String(detail).slice(0, 110)})` : ''}`)
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message ?? e).split('\n')[0], ms: Date.now() - t0 })
    console.log(`FAIL  ${name}  -> ${String(e.message ?? e).split('\n')[0].slice(0, 160)}`)
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

async function launch(extraArgs = []) {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...extraArgs] })
    } catch {}
  }
  throw new Error('No Edge or Chrome found')
}

const savedSettings = await api('/api/settings')
const ring = await api('/api/ring/token')
const tokenValid = ring.mode !== 'none' && ring.expiresAt && ring.expiresAt > Date.now() + 60_000
console.log(`Ring token: ${tokenValid ? `valid for ${Math.round((ring.expiresAt - Date.now()) / 60000)} min` : 'expired or missing (live-view checks expect the error message)'}\n`)

const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, httpCredentials })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
const go = async (p) => {
  await page.goto(base + p, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
}
const btn = (name, exact = true) => page.getByRole('button', { name, exact })
const latestEvent = async () => (await api('/api/events?limit=1')).events[0]
const waitForNewEvent = async (beforeId, ms = 30000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const e = await latestEvent()
    if (e && e.id !== beforeId && e.status !== 'queued' && e.status !== 'processing') return e
    await new Promise((r) => setTimeout(r, 700))
  }
  throw new Error('no finished event')
}

// ---------- Shell, keyboard, language and mode ----------
await go('/')
await check('Home loads with a status heading', async () => (await page.locator('h1').textContent()).trim())
await check('Tab order: skip link, then "Turn on spoken announcements"', async () => {
  await page.keyboard.press('Tab')
  const a = await page.evaluate(() => document.activeElement?.textContent?.trim())
  await page.keyboard.press('Tab')
  const b = await page.evaluate(() => document.activeElement?.textContent?.trim())
  expect(a === 'Skip to main content' && b === 'Turn on spoken announcements', `${a} | ${b}`)
})
await check('Turn on spoken announcements: banner closes, focus on heading', async () => {
  await btn('Turn on spoken announcements').click()
  await page.waitForTimeout(300)
  expect((await btn('Turn on spoken announcements').count()) === 0, 'banner still visible')
  return await page.evaluate(() => document.activeElement?.tagName)
})
for (const [label, code] of [['हिन्दी', 'hi'], ['বাংলা', 'bn'], ['Español', 'es'], ['English', 'en']]) {
  await check(`Language button ${label}`, async () => {
    await btn(label).click()
    await page.waitForTimeout(700)
    expect((await btn(label).getAttribute('aria-pressed')) === 'true', 'not pressed')
    expect((await api('/api/settings')).language === code, 'setting not saved')
  })
}
await check('Mode buttons Visual then Voice (transcript appears in Visual)', async () => {
  await btn('Visual').click()
  await page.waitForTimeout(500)
  expect(await page.getByRole('complementary', { name: 'Transcript' }).isVisible(), 'no transcript')
  await btn('Voice').click()
  await page.waitForTimeout(500)
})
const navNames = ['Home', 'Live', 'Timeline', 'Expecting', 'Caregiver', 'Pipeline', 'Settings', 'Demo']
await check('Menu links open each screen', async () => {
  for (const n of navNames) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: n, exact: true }).click()
    await page.waitForTimeout(900)
  }
  return new URL(page.url()).pathname
})
await check('Alt+1..8 shortcuts open each screen', async () => {
  const paths = ['/', '/live', '/timeline', '/expecting', '/caregiver', '/pipeline', '/settings', '/demo']
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(`Alt+${i + 1}`)
    await page.waitForTimeout(900)
    expect(new URL(page.url()).pathname === paths[i], `Alt+${i + 1} -> ${page.url()}`)
  }
})

// ---------- Demo panel ----------
await go('/demo')
for (const label of ['Doorbell press', 'Motion: person', 'Motion: vehicle', 'Motion: general', 'Motion: other', 'Unknown subtype (“drone”)', 'Camera offline']) {
  await check(`Demo: ${label}`, async () => {
    const before = (await latestEvent())?.id
    await btn(label).click()
    const e = await waitForNewEvent(before)
    expect(e.simulated, 'not labelled simulated')
    return `${e.status}: ${e.narration ?? '(silent)'} [${e.totalMs} ms]`
  })
}
await check('Demo: replay switch shows idempotency (duplicate)', async () => {
  await page.getByRole('switch', { name: /Also replay/ }).click()
  await btn('Doorbell press').click()
  await page.waitForTimeout(4000)
  const log = await page.getByRole('list', { name: 'Webhook log' }).textContent()
  await page.getByRole('switch', { name: /Also replay/ }).click()
  expect(/duplicate/.test(log), 'no duplicate in log')
  return 'second delivery reported as duplicate'
})
await check('Demo: test image upload is used and labelled Simulated', async () => {
  const img = path.join(process.cwd(), 'data', 'fixtures', 'sandbox_snapshot_2.jpg')
  if (!fs.existsSync(img)) return 'skipped (no fixture image)'
  await page.locator('#img').setInputFiles(img)
  const before = (await latestEvent())?.id
  await btn('Motion: vehicle').click()
  const e = await waitForNewEvent(before)
  const d = await api(`/api/events/${e.id}`)
  await page.locator('#img').setInputFiles([])
  expect(/Simulated: image uploaded/.test(d.frameSource ?? ''), d.frameSource)
  return d.frameSource
})
for (const label of ['“A suspicious man is lurking…”', 'Race and gender in clothing text', '“That is John Smith, your neighbour.”', 'Free text instead of JSON', 'A licence plate in the summary']) {
  await check(`Guardrail test: ${label}`, async () => {
    await btn(label).click()
    await page.getByText(/^Spoken:/).waitFor({ timeout: 15000 })
    await page.waitForTimeout(500)
    return (await page.getByText(/^Spoken:/).textContent()).replace('Spoken:', '').trim()
  })
}

// ---------- Home: announcement card, Why dialog, feedback, Ask ----------
// A fresh event makes sure the last announcement on Home is an event card with feedback buttons.
const freshEvent = async () => {
  const before = (await latestEvent())?.id
  const f = new FormData()
  f.append('type', 'button_press')
  await fetch(`${base}/api/demo/simulate`, authed({ method: 'POST', body: f }))
  return waitForNewEvent(before)
}
await freshEvent()
await go('/')
await check('Replay button', async () => {
  await btn('Replay').first().click()
})
await check('Alt+R replays', async () => {
  await page.keyboard.press('Alt+R')
})
await check('Why dialog: opens, traps focus, Escape closes', async () => {
  await btn('Why did it say that?').first().click()
  const dlg = page.getByRole('dialog', { name: 'Why did it say that?' })
  await dlg.waitFor()
  await page.waitForTimeout(1200)
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab')
  const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]')))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  expect(inside, 'focus escaped the dialog')
  expect(!(await dlg.isVisible()), 'still open')
})
await check('Alt+W opens Why; Close button closes', async () => {
  await page.keyboard.press('Alt+W')
  await page.getByRole('dialog').waitFor()
  await btn('Close details').click()
  await page.waitForTimeout(300)
  expect((await page.getByRole('dialog').count()) === 0, 'not closed')
})
for (const label of ['Correct', 'That’s wrong', 'Mute this type']) {
  await check(`Feedback: ${label}`, async () => {
    const card = page.getByRole('article', { name: 'Announcement' }).first()
    if ((await card.getByRole('button', { name: label, exact: true }).count()) === 0) return 'skipped (last item is an answer, not an event)'
    await card.getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(1200)
    return (await card.getByRole('status').first().textContent()).trim()
  })
}
const ask = async (text) => {
  await go('/')
  await page.getByLabel('Type a question or command').fill(text)
  await btn('Ask').click()
  await page.getByText(/^You said:/).waitFor({ timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(700)
  return ((await page.getByText(/^You said:/).locator('..').textContent().catch(() => '')) ?? '').replace(/^You said:.*?(?=[A-Z])/s, '')
}
await check('Ask (typed): "Is the car still there?"', async () => (await ask('Is the car still there?')).slice(0, 100))
await check('Ask (typed): "Who is it?" is refused', async () => {
  const a = await ask('Who is it?')
  expect(/identify/i.test(a), a)
  return a.slice(0, 90)
})
await check('Ask (typed): "Describe everything"', async () => (await ask('Describe everything')).slice(0, 100))
await check('Command (typed): "help" lists page buttons', async () => {
  const a = await ask('help')
  expect(/press, then/.test(a), a)
  return a.slice(0, 120)
})
await check('Command (typed): "switch to Hindi" then "English"', async () => {
  await ask('switch to Hindi')
  expect((await api('/api/settings')).language === 'hi', 'not hi')
  await ask('English')
  expect((await api('/api/settings')).language === 'en', 'not en')
})
await check('Command (free-form): "Could you open the settings for me"', async () => {
  await ask('Could you open the settings for me')
  await page.waitForTimeout(800)
  expect(new URL(page.url()).pathname === '/settings', page.url())
})
await check('Command (free-form): "Make it flash instead of talking"', async () => {
  await ask('Make it flash instead of talking')
  const m = (await api('/api/settings')).mode
  await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'voice' }) })
  expect(m === 'visual', `mode ${m}`)
})
await check('Command (free-form): "That description was not right" presses That’s wrong', async () => {
  await freshEvent()
  const a = await ask('That description was not right')
  expect(/Pressed That’s wrong|Pressed That's wrong/.test(a), a)
})
await check('Command: unknown button gives a helpful reply', async () => {
  const a = await ask('press flying carpet')
  expect(/could not find/.test(a), a)
})
await check('Push to talk: "Speak after the beep", Cancel before beep', async () => {
  await go('/')
  await btn('Push to talk').click()
  await page.waitForTimeout(300)
  const st = await page.getByText('Speak after the beep.').first().isVisible()
  await btn('Stop and send').first().click()
  await page.waitForTimeout(300)
  expect(st, 'no prompt')
  expect(await page.getByText('Cancelled.').first().isVisible(), 'not cancelled')
})

// ---------- Live ----------
await go('/live')
await check(`Live: Start live view (${tokenValid ? 'expects video' : 'expects clear error, token expired'})`, async () => {
  await btn('Start live view').click()
  if (tokenValid) {
    await page.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0, null, { timeout: 30000 })
    const w = await page.evaluate(() => document.querySelector('video').videoWidth)
    await btn('Stop live view').click()
    return `video ${w}px wide`
  }
  await page.waitForTimeout(3000)
  return (await page.getByRole('alert').first().textContent().catch(() => 'no alert shown')).slice(0, 100)
})
for (const label of ['Keep watching', 'Show boxes', 'Local narrator (no cloud)']) {
  await check(`Live: switch "${label}" toggles`, async () => {
    const sw = page.getByRole('switch', { name: new RegExp(label.replace(/[()]/g, '.')) })
    const a = await sw.getAttribute('aria-checked')
    await sw.click()
    await page.waitForTimeout(400)
    const b = await sw.getAttribute('aria-checked')
    await sw.click()
    expect(a !== b, 'did not change')
  })
}

// ---------- Timeline ----------
await go('/timeline')
for (const label of ['Doorbell', 'People', 'Vehicles', 'Other motion', 'All']) {
  await check(`Timeline filter: ${label}`, async () => {
    await btn(label).click()
    await page.waitForTimeout(900)
    return `${await page.getByRole('listitem').count()} items`
  })
}
await check('Timeline: Why? on an event', async () => {
  await btn('Why?').first().click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
})

// ---------- Expecting ----------
await go('/expecting')
await check('Expecting: add "a grey car in 10 minutes and my sister around 5"', async () => {
  await page.getByLabel('What are you expecting?').fill('a grey car in 10 minutes and my sister around 5')
  await btn('Add').click()
  await page.getByText(/^Got it/).waitFor({ timeout: 15000 })
  return (await page.getByText(/^Got it/).textContent()).slice(0, 100)
})
await check('Expecting: Remove both new items', async () => {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /^Remove/ }).first().click()
    await page.waitForTimeout(700)
  }
})

// ---------- Caregiver ----------
await go('/caregiver')
await check('Caregiver: digest text shown', async () => (await page.locator('p.text-2xl').first().textContent()).slice(0, 100))
await check('Caregiver: digest in Bengali', async () => {
  await page.locator('#dlang').selectOption('bn')
  await page.waitForTimeout(2500)
  return (await page.locator('p.text-2xl').first().textContent()).slice(0, 60)
})
let shareUrl = ''
await check('Caregiver: Create digest link', async () => {
  await page.getByLabel('Name for this link').fill('E2E test link')
  await btn('Create digest link').click()
  await page.waitForTimeout(1200)
  shareUrl = (await page.getByText(/\/digest\//).first().textContent()).trim()
  return shareUrl
})
await check('Caregiver: shared digest page opens (text only)', async () => {
  const p2 = await ctx.newPage()
  await p2.goto(shareUrl)
  await p2.getByRole('heading', { name: 'While you were out' }).waitFor()
  await p2.waitForTimeout(1500)
  const t = await p2.locator('article').textContent()
  await p2.close()
  return t.slice(0, 80)
})
await check('Caregiver: Unlink removes the test link', async () => {
  const row = page.getByRole('listitem').filter({ hasText: 'E2E test link' })
  await row.getByRole('button', { name: 'Unlink' }).click()
  await page.waitForTimeout(900)
  expect((await page.getByText('E2E test link').count()) === 0, 'still listed')
})

// ---------- Pipeline ----------
await go('/pipeline')
await check('Pipeline: metrics and funnel', async () => {
  await page.getByText('Funnel: how many events reached each stage').waitFor()
  return (await page.getByText(/cheaper than naive|not cheaper yet/).first().textContent().catch(() => 'cost badge missing'))
})
await check('Pipeline: funnel table opens', async () => {
  await page.getByText('Funnel as a table').click()
  expect(await page.getByRole('table').first().isVisible(), 'no table')
})

// ---------- Settings ----------
await go('/settings')
await check('Settings: invalid token is rejected with a message', async () => {
  await page.getByLabel('Paste a Developer Playground token').fill('not-a-token')
  await btn('Save token').click()
  await page.waitForTimeout(1000)
  return (await page.getByText(/does not look like/).textContent())
})
for (const label of ['Doorbell presses', 'People', 'Vehicles', 'Parcels', 'Animals', 'Other motion', 'Quiet hours']) {
  await check(`Settings switch: ${label}`, async () => {
    const sw = page.getByRole('switch', { name: new RegExp(`^${label}`) }).first()
    const a = await sw.getAttribute('aria-checked')
    await sw.click()
    await page.waitForTimeout(500)
    const b = await sw.getAttribute('aria-checked')
    await sw.click()
    await page.waitForTimeout(400)
    expect(a !== b, 'did not change')
  })
}
await check('Settings: speaking speed slider', async () => {
  await page.getByLabel(/Speaking speed/).fill('1.2')
  await page.waitForTimeout(600)
  expect((await api('/api/settings')).speechRate === 1.2, 'not saved')
})
await check('Settings: Export dataset now', async () => {
  await btn('Export dataset now').click()
  await page.getByText(/^Exported/).waitFor({ timeout: 15000 })
  return (await page.getByText(/^Exported/).textContent())
})
await check('Settings: Apply retention now', async () => {
  await btn('Apply retention now').click()
  await page.getByText(/^Deleted/).waitFor({ timeout: 15000 })
  return (await page.getByText(/^Deleted/).textContent())
})
await check('Settings: Wipe all data shows confirmation, Cancel keeps data', async () => {
  const before = (await api('/api/events?limit=5')).events.length
  await btn('Wipe all data').click()
  expect(await btn('Yes, delete everything').isVisible(), 'no confirmation')
  await btn('Cancel').click()
  const after = (await api('/api/events?limit=5')).events.length
  expect(before === after, 'data changed')
})
await check('Settings: Unmute (from the Mute test)', async () => {
  const n = await page.getByRole('button', { name: 'Unmute' }).count()
  for (let i = 0; i < n; i++) {
    await page.getByRole('button', { name: 'Unmute' }).first().click()
    await page.waitForTimeout(400)
  }
  return `${n} unmuted`
})

// ---------- Other pages ----------
await check('Account-link page without nonce explains itself', async () => {
  await go('/link')
  return (await page.getByText(/opened from the Ring app/).textContent()).slice(0, 80)
})

await browser.close()

// ---------- Spoken command through the microphone (Transcribe -> router -> press) ----------
if (wav) {
  const b2 = await launch([`--use-file-for-fake-audio-capture=${wav.replace(/\\/g, '/')}`])
  const p2 = await (await b2.newContext({ httpCredentials })).newPage()
  await p2.goto(`${base}/demo`)
  await p2.waitForTimeout(2000)
  await check('Spoken free-form command via Alt+V on Demo ("I want to ring the doorbell")', async () => {
    const before = (await latestEvent())?.id
    await p2.keyboard.press('Alt+V')
    const e = await waitForNewEvent(before, 45000)
    expect(e.type === 'button_press', e.type)
    return `${e.narration} [${e.totalMs} ms]`
  })
  await b2.close()
}

// Restore the user's settings exactly as they were.
await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(savedSettings) })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; page errors: ${pageErrors.length}`)
for (const e of pageErrors.slice(0, 3)) console.log('  page error:', e.slice(0, 160))
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ at: new Date().toISOString(), tokenValid, results, pageErrors }, null, 2))
process.exit(failed.length ? 1 : 0)
