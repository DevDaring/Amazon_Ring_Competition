import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// WCAG 2.1 relative luminance and contrast ratio.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf-8')
function tokens(block: string) {
  return Object.fromEntries(Array.from(block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)).map((m) => [m[1], m[2]]))
}
const light = tokens(css.split('@media')[0])
const dark = tokens(css.slice(css.indexOf(":root[data-theme='dark']")))

const PAIRS: Array<[string, string]> = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'raised'], ['muted', 'bg'], ['muted', 'surface'],
  ['accent-ink', 'accent'], ['bad-ink', 'bad'], ['accent', 'bg'], ['accent', 'surface'], ['ok', 'surface'], ['warn', 'surface'], ['bad', 'surface'],
]

describe.each([['light', light], ['dark', dark]])('%s theme contrast (WCAG AA)', (_name, t) => {
  it.each(PAIRS)('%s on %s >= 4.5:1', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('deaf-mode flash colours keep white caption text readable', () => {
  it.each(['flash-doorbell', 'flash-person', 'flash-vehicle', 'flash-package', 'flash-other'])('%s with white text >= 4.5:1', (k) => {
    expect(ratio('#ffffff', light[k])).toBeGreaterThanOrEqual(4.5)
  })
})
