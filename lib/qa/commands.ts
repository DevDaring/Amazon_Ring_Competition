// Voice commands: "press doorbell press", "go to settings", "switch to Hindi", "help".
// Pure text rules, no model call: a command must be instant, free and predictable.
// The browser then finds the button by its accessible name and presses it.

export type UiCommand =
  | { type: 'navigate'; path: string; page: string; then?: string }
  | { type: 'press'; target: string }
  | { type: 'language'; lang: 'en' | 'hi' | 'bn' | 'es' }
  | { type: 'mode'; mode: 'voice' | 'visual' }
  | { type: 'replay' }
  | { type: 'why' }
  | { type: 'help' }
  | { type: 'close' }

/**
 * Main actions on each screen, so "start live view" said on Home (or "I want to see
 * live video") goes to the right screen and presses the button there.
 */
export const PAGE_ACTIONS: Record<string, { path: string; page: string; buttons: string[] }> = {
  live: { path: '/live', page: 'Live', buttons: ['Start live view', 'Stop live view'] },
  demo: {
    path: '/demo',
    page: 'Demo',
    buttons: ['Doorbell press', 'Motion: person', 'Motion: vehicle', 'Motion: general', 'Motion: other', 'Camera offline'],
  },
  settings: { path: '/settings', page: 'Settings', buttons: ['Export dataset now', 'Apply retention now', 'Save token'] },
  caregiver: { path: '/caregiver', page: 'Caregiver', buttons: ['Create digest link'] },
  expecting: { path: '/expecting', page: 'Expecting', buttons: ['Say it'] },
}

/** Finds a button on another screen that matches a spoken target. */
export function findPageAction(target: string): { path: string; page: string; button: string } | null {
  let best: { path: string; page: string; button: string; score: number } | null = null
  for (const a of Object.values(PAGE_ACTIONS))
    for (const b of a.buttons) {
      const score = matchScore(target, b)
      if (score >= 60 && (!best || score > best.score)) best = { path: a.path, page: a.page, button: b, score }
    }
  return best ? { path: best.path, page: best.page, button: best.button } : null
}

const PAGES: Array<[RegExp, string, string]> = [
  [/^(home|main|होम|হোম|inicio)$/, '/', 'Home'],
  [/^(live|live view|camera|लाइव|লাইভ|en vivo)$/, '/live', 'Live'],
  [/^(timeline|history|events|टाइमलाइन|টাইমলাইন|historial)$/, '/timeline', 'Timeline'],
  [/^(expecting|expectations|i'?m expecting)$/, '/expecting', 'Expecting'],
  [/^(caregiver|care giver|digest|केयरगिवर|কেয়ারগিভার)$/, '/caregiver', 'Caregiver'],
  [/^(pipeline|पाइपलाइन|পাইপলাইন)$/, '/pipeline', 'Pipeline'],
  [/^(settings|setting|सेटिंग्स|সেটিংস|ajustes|configuración)$/, '/settings', 'Settings'],
  [/^(demo|demo panel|डेमो|ডেমো)$/, '/demo', 'Demo'],
]

const LANGS: Array<[RegExp, 'en' | 'hi' | 'bn' | 'es']> = [
  [/^(english|इंग्लिश|ইংরেজি|inglés)$/, 'en'],
  [/^(hindi|हिंदी|हिन्दी|হিন্দি)$/, 'hi'],
  [/^(bengali|bangla|बंगाली|বাংলা)$/, 'bn'],
  [/^(spanish|español|espanol|स्पेनिश|স্প্যানিশ)$/, 'es'],
]

// Questions go to Ask the Door, never to the command path.
const QUESTION = /^(is|are|who|what|where|when|which|did|does|do|has|have|can you|could you|how|read|describe|tell me)\b|\?\s*$|कौन|क्या|কে|কী|quién|qué/i

function clean(text: string) {
  return text
    .toLowerCase()
    .replace(/['‘’]/g, '') // "that’s" -> "thats", as speech-to-text writes it
    .replace(/[“”".,!;:।]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function page(name: string) {
  const n = name.replace(/^the /, '').replace(/ (page|screen|tab|section)$/, '').trim()
  const hit = PAGES.find(([re]) => re.test(n))
  return hit ? { type: 'navigate' as const, path: hit[1], page: hit[2] } : null
}

function language(name: string) {
  const n = name.replace(/ (language|mode)$/, '').trim()
  const hit = LANGS.find(([re]) => re.test(n))
  return hit ? { type: 'language' as const, lang: hit[1] } : null
}

export function parseCommand(input: string): UiCommand | null {
  const raw = input.trim()
  if (!raw) return null
  const t = clean(raw)

  // Built-in commands first: "what can I say" and "why did it say that" look like questions.
  if (/^(help|what can i say|what can i do|list (the )?buttons|which buttons|read (the )?buttons|options|मदद|সাহায্য|ayuda)$/.test(t)) return { type: 'help' }
  if (/^(replay|repeat|say (that|it) again|play again|दोबारा|আবার|repetir)$/.test(t)) return { type: 'replay' }
  if (/^why( did it say that)?$/.test(t)) return { type: 'why' }
  if (/^(close|close (the )?(dialog|window|panel)|cancel|escape|बंद करो|বন্ধ করো|cerrar)$/.test(t)) return { type: 'close' }
  if (QUESTION.test(raw)) return null

  // Mode: "turn on visual mode", "voice mode", "deaf mode".
  const mode = t.match(/^(?:(?:turn on|switch to|use|enable|change to) )?(visual|deaf|voice|speech|spoken) mode$/)
  if (mode) return { type: 'mode', mode: mode[1] === 'visual' || mode[1] === 'deaf' ? 'visual' : 'voice' }

  // Language: "switch to Hindi", "change language to Bengali", or just "Hindi".
  const lang = t.match(/^(?:(?:switch|change|set)(?: the)?(?: language)? to |speak )(.+)$/)
  if (lang) return language(lang[1])
  const bareLang = language(t)
  if (bareLang) return bareLang

  // Live video in any phrasing that is clearly about watching: go to Live and start it.
  if (/\bstop\b.*\b(live|video|stream|camera)\b/.test(t)) return { type: 'navigate', path: '/live', page: 'Live', then: 'Stop live view' }
  if (/\b(see|watch|show|start|open|play|view|turn on)\b.*\b(live( video| view| stream| feed)?|camera( feed)?|video)\b/.test(t)) {
    return { type: 'navigate', path: '/live', page: 'Live', then: 'Start live view' }
  }

  // Navigation: "go to settings", "open the demo page", or just "settings".
  const nav = t.match(/^(?:go to|open|show|take me to|navigate to|ve a|abre|खोलो|खोलें|খোলো|খুলুন)\s+(.+)$/) || t.match(/^(.+?)\s+(?:खोलो|खोलें|पर जाओ|খোলো|খুলুন|এ যাও)$/)
  if (nav) {
    const p = page(nav[1])
    if (p) return p
  }
  const barePage = page(t)
  if (barePage) return barePage

  // Press: "press doorbell press", "click the start live view button", "tap correct".
  const press = t.match(/^(?:press|click(?: on)?|tap(?: on)?|select|activate|hit|choose|push|pulsa|presiona|toca|haz clic en)\s+(?:the\s+)?(.+?)(?:\s+(?:button|link|switch|toggle))?$/)
  if (press) return { type: 'press', target: press[1] }
  const pressAfter = t.match(/^(.+?)\s+(?:दबाओ|दबाएं|दबाइए|क्लिक करो|চাপো|চাপুন|ক্লিক করো)$/)
  if (pressAfter) return { type: 'press', target: pressAfter[1] }

  // Verbs that are part of button names: "start live view", "turn on spoken announcements", "stop live view".
  if (/^(start|stop|turn on|turn off|create|save|add|export|apply|wipe|remove|unlink|copy|refresh)\b/.test(t)) return { type: 'press', target: t }
  return null
}

/** Score how well a spoken target matches a button's accessible name (0 = no match). */
export function matchScore(target: string, name: string): number {
  const a = clean(target)
  const b = clean(name)
  if (!a || !b) return 0
  if (a === b) return 100
  if (b.startsWith(a) || b.includes(a)) return 80 - Math.min(30, b.length - a.length)
  if (a.includes(b) && b.length >= 3) return 60
  const ta = new Set(a.split(' ').filter((w) => w.length > 1 && !['the', 'a', 'an', 'to', 'of'].includes(w)))
  const tb = new Set(b.split(' ').filter((w) => w.length > 1 && !['the', 'a', 'an', 'to', 'of'].includes(w)))
  if (!ta.size || !tb.size) return 0
  const shared = Array.from(ta).filter((w) => tb.has(w)).length
  const overlap = shared / Math.max(ta.size, tb.size)
  return overlap >= 0.5 ? Math.round(overlap * 50) : 0
}
