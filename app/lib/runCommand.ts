'use client'

import { matchScore, type UiCommand } from '@/lib/qa/commands'
import type { Announcement, Language, Settings } from './types'
import { LANG_LABEL } from './types'

// Carries out a voice command in the page the user is on. Buttons are found by their
// accessible name (what a screen reader would say), so every control is reachable by
// voice without a separate list to keep in sync.

export interface CommandDeps {
  navigate: (path: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  latest: Announcement | null
  replay: (a: Announcement) => void
  openWhy: (id: string | null) => void
}

const SELECTOR = 'button, a[href], [role="button"], [role="switch"], [role="tab"], summary'

function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) return labelledBy.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    // A switch's label holds its title and description; the title is the first line.
    if (label) return (label.querySelector('span')?.textContent ?? label.textContent ?? '').trim()
  }
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function controls(): Array<{ el: HTMLElement; name: string }> {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))
    .filter((el) => {
      if (el.closest('[data-voice-ignore]')) return false
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 // visible on screen (or scrollable to)
    })
    .map((el) => ({ el, name: accessibleName(el) }))
    .filter((c) => c.name.length > 0)
}

/** Names of the controls on screen. mainOnly: just the page itself, for reading out in "help". */
export function controlNames(limit = 14, mainOnly = true): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const all = controls().filter((c) => !mainOnly || c.el.closest('main'))
  for (const c of all) {
    const k = c.name.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(c.name)
    }
    if (out.length >= limit) break
  }
  return out
}

export function runCommand(cmd: UiCommand, deps: CommandDeps): string {
  switch (cmd.type) {
    case 'navigate':
      deps.navigate(cmd.path)
      return `Opening ${cmd.page}.`
    case 'language':
      deps.updateSettings({ language: cmd.lang as Language })
      return `Language set to ${LANG_LABEL[cmd.lang as Language]}.`
    case 'mode':
      deps.updateSettings({ mode: cmd.mode })
      return cmd.mode === 'visual' ? 'Visual mode on: flashes, captions and vibration.' : 'Voice mode on.'
    case 'replay':
      if (!deps.latest) return 'There is nothing to replay yet.'
      deps.replay(deps.latest)
      return ''
    case 'why':
      if (!deps.latest) return 'There is no announcement to explain yet.'
      deps.openWhy(deps.latest.id)
      return 'Opening the explanation.'
    case 'close':
      deps.openWhy(null)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return 'Closed.'
    case 'help':
      return `On this page you can say press, then: ${controlNames().join('; ')}. You can also say go to and a page name, switch to Hindi, visual mode, replay, or ask about the door.`
    case 'press': {
      const ranked = controls()
        .map((c) => ({ ...c, score: matchScore(cmd.target, c.name) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
      const best = ranked[0]
      if (!best || best.score < 40) {
        return `I could not find a button called “${cmd.target}”. Buttons here include: ${controlNames(6).join('; ')}. Say help to hear them all.`
      }
      // A destructive confirmation needs the exact words, never a loose match.
      if (/delete everything|wipe/i.test(best.name) && best.score < 100) {
        return `To confirm, say exactly: press ${best.name}.`
      }
      best.el.focus()
      best.el.click()
      return `Pressed ${best.name}.`
    }
  }
}
