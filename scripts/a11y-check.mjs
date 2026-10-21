// Automated accessibility pass: loads every screen in a real browser (installed Edge
// or Chrome), runs axe-core (WCAG 2.1 A/AA rules), checks keyboard reachability of
// the main controls, and saves a screenshot per screen in data/a11y/.
// Usage: npm run start (or dev) in one terminal, then `npm run a11y`.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8')
const base = process.env.BASE_URL || 'http://localhost:3000'
const out = path.join(process.cwd(), 'data', 'a11y')
fs.mkdirSync(out, { recursive: true })

const PAGES = ['/', '/live', '/timeline', '/expecting', '/caregiver', '/pipeline', '/settings', '/demo']

let browser
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true })
    break
  } catch {
    /* try the next installed browser */
  }
}
if (!browser) {
  console.error('No Edge or Chrome found for the accessibility check.')
  process.exit(1)
}

const results = []
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })
  for (const p of PAGES) {
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(base + p, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    await page.addScriptTag({ content: axeSource })
    const axe = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0]?.target?.join(' ') }))
    })
    // Keyboard: Tab through the page and record what gets focus.
    const focusable = []
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      focusable.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 40)))
    }
    if (scheme === 'dark') await page.screenshot({ path: path.join(out, `${p === '/' ? 'home' : p.slice(1)}.png`), fullPage: true })
    // 200% zoom: the layout must not need horizontal scrolling.
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    results.push({ page: p, scheme, violations: axe, consoleErrors: errors, firstTabStops: focusable.filter(Boolean).slice(0, 6), horizontalScrollAt200: hScroll })
    await page.close()
  }
  await ctx.close()
}
await browser.close()

let failed = 0
for (const r of results) {
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  failed += bad.length
  console.log(`\n${r.page} [${r.scheme}]  axe violations: ${r.violations.length} (${bad.length} serious/critical)  console errors: ${r.consoleErrors.length}  h-scroll at 200%: ${r.horizontalScrollAt200}`)
  for (const v of r.violations) console.log(`   - ${v.impact} ${v.id}: ${v.help} (${v.nodes} node(s), e.g. ${v.sample})`)
  for (const e of r.consoleErrors.slice(0, 3)) console.log(`   ! ${e.slice(0, 160)}`)
  if (r.scheme === 'dark') console.log(`   tab order: ${r.firstTabStops.join(' → ')}`)
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(results, null, 2))
console.log(`\nReport: data/a11y/report.json · screenshots: data/a11y/*.png`)
process.exit(failed ? 1 : 0)
