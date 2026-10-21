import { providers, withFallback } from '../providers/registry'
import { extractJson } from '../providers/util'

// "I'm expecting a grocery delivery and my sister around 5."
// -> [{kind: delivery, objectType: grocery_bag, ...}, {kind: visitor, ...}]
// People are stored only as "visitor": the app never links a face to a named person.

export interface ParsedExpectation {
  text: string
  kind: 'delivery' | 'visitor' | 'vehicle' | 'service'
  objectType?: string | null
  vehicleColour?: string | null
  vehicleType?: string | null
  windowStart: Date
  windowEnd: Date
}

const KIND_RULES: Array<[RegExp, Omit<ParsedExpectation, 'text' | 'windowStart' | 'windowEnd'>]> = [
  [/grocer|blinkit|zepto|instacart|bigbasket|vegetables/i, { kind: 'delivery', objectType: 'grocery_bag' }],
  [/food|pizza|takeaway|take-away|swiggy|zomato|doordash|uber ?eats|meal|dinner|lunch/i, { kind: 'delivery', objectType: 'food_delivery' }],
  [/flower|bouquet/i, { kind: 'delivery', objectType: 'flowers' }],
  [/parcel|package|amazon|courier|delivery|post|mail|letter|ups|fedex|dhl|flipkart/i, { kind: 'delivery', objectType: 'parcel' }],
  [/plumber|electrician|technician|cleaner|repair|engineer|installer|gardener|maid|nurse|carer|caregiver/i, { kind: 'service' }],
  [/\b(car|van|truck|lorry|taxi|cab|uber|ola|auto|bike|motorbike)\b/i, { kind: 'vehicle' }],
  [/sister|brother|mother|father|mom|mum|dad|son|daughter|friend|guest|visitor|someone|aunt|uncle|cousin|neighbou?r|grand/i, { kind: 'visitor' }],
]

const COLOURS = ['black', 'white', 'grey', 'gray', 'silver', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'beige']
const VEHICLE_WORDS: Record<string, string> = { car: 'car', taxi: 'car', cab: 'car', uber: 'car', ola: 'car', van: 'van', truck: 'truck', lorry: 'truck', bike: 'motorcycle', motorbike: 'motorcycle', auto: 'other' }

/** Turns "around 5", "at 5:30pm", "by 17:00", "in an hour" into a window. */
export function parseWindow(text: string, now = new Date()): { start: Date; end: Date } | null {
  const t = text.toLowerCase()
  const inMinutes = t.match(/in (\d+) min(?:ute)?s?/)
  if (inMinutes) {
    const c = new Date(now.getTime() + Number(inMinutes[1]) * 60_000)
    return { start: new Date(now.getTime() - 5 * 60_000), end: new Date(c.getTime() + 30 * 60_000) }
  }
  const inHours = t.match(/in (an|one|\d+(?:\.\d+)?) hours?/)
  if (inHours) {
    const h = inHours[1] === 'an' || inHours[1] === 'one' ? 1 : Number(inHours[1])
    const c = new Date(now.getTime() + h * 3600_000)
    return { start: new Date(c.getTime() - 30 * 60_000), end: new Date(c.getTime() + 45 * 60_000) }
  }
  const between = t.match(/between (\d{1,2})(?::(\d{2}))?\s*(am|pm)? and (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  if (between) {
    const a = toDate(Number(between[1]), Number(between[2] ?? 0), between[3] ?? between[6], now)
    let b = toDate(Number(between[4]), Number(between[5] ?? 0), between[6], now)
    if (b <= a) b = new Date(b.getTime() + 12 * 3600_000)
    return { start: a, end: b }
  }
  const at = t.match(/(?:around|about|at|by|after|before|near)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'?clock)?/) || t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/) || t.match(/\b(\d{1,2})\s*(am|pm)\b/)
  if (at) {
    const isMatch3 = at.length === 3 // the "5pm" form has no minutes group
    const hour = Number(at[1])
    const min = isMatch3 ? 0 : Number(at[2] ?? 0)
    const ampm = isMatch3 ? at[2] : at[3]
    const c = toDate(hour, min, ampm, now)
    const before = /by|before/.test(at[0])
    const after = /after/.test(at[0])
    return {
      start: before ? now : new Date(c.getTime() - (after ? 0 : 45) * 60_000),
      end: after ? new Date(c.getTime() + 3 * 3600_000) : new Date(c.getTime() + 45 * 60_000),
    }
  }
  if (/this evening|tonight/.test(t)) return { start: atHour(now, 17), end: atHour(now, 21) }
  if (/this afternoon/.test(t)) return { start: atHour(now, 12), end: atHour(now, 17) }
  if (/this morning/.test(t)) return { start: now, end: atHour(now, 12) }
  if (/today|later/.test(t)) return { start: now, end: atHour(now, 22) }
  return null
}

function atHour(now: Date, h: number) {
  const d = new Date(now)
  d.setHours(h, 0, 0, 0)
  return d
}

/** Picks the next occurrence of an hour that may lack am/pm ("around 5" at 2 pm means 5 pm). */
function toDate(h: number, m: number, ampm: string | undefined, now: Date) {
  let hour = h % 24
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  const d = new Date(now)
  d.setHours(hour, m, 0, 0)
  if (!ampm || /o'?clock/.test(ampm)) {
    if (hour <= 12 && d.getTime() < now.getTime() - 60 * 60_000) d.setHours(hour + 12)
  }
  if (d.getTime() < now.getTime() - 60 * 60_000) d.setDate(d.getDate() + 1)
  return d
}

export function parseExpectationsRule(input: string, now = new Date()): ParsedExpectation[] {
  const cleaned = input.replace(/^\s*(i'?m|i am|we'?re|we are)\s+(expecting|waiting for)\s+/i, '')
  const sharedWindow = parseWindow(cleaned, now)
  const parts = cleaned.split(/\s*(?:,|;|\band\b|\balso\b)\s*/i).filter((p) => p.trim().length > 1)
  const out: ParsedExpectation[] = []
  for (const part of parts) {
    const rule = KIND_RULES.find(([re]) => re.test(part))
    if (!rule) continue
    const w = parseWindow(part, now) ?? sharedWindow ?? { start: now, end: new Date(now.getTime() + 4 * 3600_000) }
    const base = { ...rule[1] }
    if (base.kind === 'vehicle' || /van|car|truck/.test(part)) {
      const colour = COLOURS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(part))
      const vw = Object.keys(VEHICLE_WORDS).find((v) => new RegExp(`\\b${v}\\b`, 'i').test(part))
      if (base.kind === 'vehicle') {
        base.vehicleColour = colour === 'gray' ? 'grey' : colour ?? null
        base.vehicleType = vw ? VEHICLE_WORDS[vw] : null
      }
    }
    const label = part
      .trim()
      .replace(/\s*\b(around|at|by|about|after|before|between|in)\s+(\d|an?\b|one\b).*$/i, '')
      .replace(/\s*\b(this (morning|afternoon|evening)|tonight|today|later)\b.*$/i, '')
      .replace(/[.!]+$/, '')
    out.push({ ...base, text: label || part.trim(), windowStart: w.start, windowEnd: w.end })
  }
  return out
}

/** Rules first (free, predictable); the fast text model only for phrasing the rules miss, e.g. Hindi. */
export async function parseExpectations(input: string, now = new Date()): Promise<{ items: ParsedExpectation[]; parser: string }> {
  const items = parseExpectationsRule(input, now)
  if (items.length) return { items, parser: 'rules' }
  try {
    const { result, provider } = await withFallback('expectations-parser', providers().text, (p) =>
      p.complete({
        system: 'You convert a short note about expected arrivals into JSON. Output JSON only.',
        prompt:
          `Now is ${now.toISOString()} (local offset ${-now.getTimezoneOffset()} min). Note: "${input}"\n` +
          'Return {"items":[{"kind":"delivery|visitor|vehicle|service","objectType":"parcel|grocery_bag|food_delivery|flowers|null",' +
          '"vehicleColour":"colour or null","vehicleType":"car|van|truck|motorcycle|null","start":"ISO time","end":"ISO time","text":"2-4 English words, no personal names"}]}. ' +
          'People become kind "visitor" with text "visitor"; never include names or relationships.',
        maxTokens: 400,
      })
    )
    const parsed = JSON.parse(extractJson(result.text).replace(/^[^{]*/, ''))
    const list: ParsedExpectation[] = (parsed.items ?? [])
      .filter((i: any) => ['delivery', 'visitor', 'vehicle', 'service'].includes(i.kind))
      .map((i: any) => ({
        text: i.kind === 'visitor' ? 'visitor' : String(i.text ?? i.kind).slice(0, 40),
        kind: i.kind,
        objectType: i.objectType && i.objectType !== 'null' ? i.objectType : null,
        vehicleColour: i.vehicleColour && i.vehicleColour !== 'null' ? i.vehicleColour : null,
        vehicleType: i.vehicleType && i.vehicleType !== 'null' ? i.vehicleType : null,
        windowStart: new Date(i.start ?? now),
        windowEnd: new Date(i.end ?? now.getTime() + 4 * 3600_000),
      }))
      .filter((i: ParsedExpectation) => !isNaN(i.windowStart.getTime()) && !isNaN(i.windowEnd.getTime()))
    return { items: list, parser: provider }
  } catch {
    return { items: [], parser: 'none' }
  }
}
