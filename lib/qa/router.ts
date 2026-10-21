import { providers, withFallback } from '../providers/registry'
import { extractJson } from '../providers/util'
import { matchScore, PAGE_ACTIONS, parseCommand, type UiCommand } from './commands'

// Second layer for voice commands: when the fixed rules do not recognise a sentence
// ("could you open the settings for me", "I want to ring the bell", "सेटिंग्स खोल दो"),
// the cheapest text model maps it onto the controls actually on the user's screen.
// The model may only choose from that list, a known page, a language or a mode;
// anything else is discarded, and the spoken feedback uses the real button name.

const PAGES = ['home', 'live', 'timeline', 'expecting', 'caregiver', 'pipeline', 'settings', 'demo']

export interface RouteResult {
  command: UiCommand | null
  model?: string
  costUsd?: number
  raw?: string
}

/** Validates the model's choice against what is really on screen. Pure, so it is unit-tested. */
export function validateRoute(parsed: any, controls: string[]): UiCommand | null {
  if (!parsed || typeof parsed !== 'object') return null
  switch (parsed.type) {
    case 'press': {
      const target = String(parsed.target ?? '')
      const exact = controls.find((c) => c.toLowerCase() === target.toLowerCase())
      if (exact) return { type: 'press', target: exact }
      const best = controls.map((c) => ({ c, s: matchScore(target, c) })).sort((a, b) => b.s - a.s)[0]
      return best && best.s >= 60 ? { type: 'press', target: best.c } : null
    }
    case 'navigate': {
      const page = String(parsed.target ?? '').toLowerCase().replace(/[^a-z]/g, '')
      if (!PAGES.includes(page)) return null
      const nav = parseCommand(page)
      // "then" must be a known button on that page, never free text.
      const then = PAGE_ACTIONS[page]?.buttons.find((b) => b.toLowerCase() === String(parsed.then ?? '').toLowerCase())
      return nav && nav.type === 'navigate' && then ? { ...nav, then } : nav
    }
    case 'language':
      return ['en', 'hi', 'bn', 'es'].includes(parsed.target) ? { type: 'language', lang: parsed.target } : null
    case 'mode':
      return parsed.target === 'visual' || parsed.target === 'voice' ? { type: 'mode', mode: parsed.target } : null
    case 'replay':
    case 'why':
    case 'help':
    case 'close':
      return { type: parsed.type }
    default:
      return null // "question" or anything unexpected: let Ask the Door answer it
  }
}

export async function routeUtterance(text: string, controls: string[]): Promise<RouteResult> {
  const list = controls.slice(0, 60)
  try {
    const { result, provider } = await withFallback('command-router', providers().text, (p) =>
      p.complete({
        tier: 'tiny',
        maxTokens: 60,
        system: 'You map a spoken sentence to one action in a doorbell app. Reply with one JSON object only.',
        prompt:
          `Sentence (any language): "${text}"\n` +
          `Buttons on screen: ${JSON.stringify(list)}\n` +
          `Pages: ${PAGES.join(', ')}. Languages: en, hi, bn, es. Modes: voice, visual.\n` +
          `Buttons on other pages (use navigate with "then"): ${JSON.stringify(Object.fromEntries(Object.entries(PAGE_ACTIONS).map(([k, v]) => [k, v.buttons])))}\n` +
          'Reply {"type":"press","target":"<exact button name from the list>"} | {"type":"navigate","target":"<page>","then":"<optional exact button on that page>"} | ' +
          '{"type":"language","target":"en|hi|bn|es"} | {"type":"mode","target":"voice|visual"} | {"type":"replay"} | {"type":"why"} | ' +
          '{"type":"help"} | {"type":"close"} | {"type":"question"} if it is a question about who or what is at the door.\n' +
          'Meanings: "Correct" = the last announcement was right; "That’s wrong" = it was wrong or inaccurate; ' +
          '"Mute this type" = stop announcing this kind of event; visual mode = flash, captions and vibration instead of speech (deaf users); ' +
          'voice mode = speak aloud; replay = say the last announcement again; why = explain the last announcement.\n' +
          'Examples: "that was not right" -> press "That’s wrong" if listed; "never tell me about these again" -> press "Mute this type" if listed; ' +
          '"make it flash instead of talking" -> mode visual; "what did it say" -> replay; "how did it decide that" -> why; ' +
          '"I want to see the camera" -> navigate live then "Start live view"; "pretend someone rang" -> navigate demo then "Doorbell press" (if not on screen).',
      })
    )
    let parsed: any = null
    try {
      parsed = JSON.parse(extractJson(result.text).replace(/^[^{]*/, '').replace(/[^}]*$/, ''))
    } catch {
      parsed = null
    }
    return { command: validateRoute(parsed, list), model: `${provider}:${result.model}`, costUsd: result.costUsd, raw: result.text.slice(0, 200) }
  } catch {
    return { command: null }
  }
}
