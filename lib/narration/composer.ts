import type { Language, Person, StructuredDescription } from '../pipeline/types'
import { ANIMALS, COLOURS, ES_VEHICLE_GENDER, NUMBERS, OBJECTS, T, VEHICLES } from './i18n'

// Turns guarded JSON into one calm, spatial sentence. Geometry first (left/centre/right,
// near/far), then count, object, action. Confidence decides the wording:
// >= 0.8 plain, 0.5-0.8 "looks like", < 0.5 "I can't tell what it is yet".

export interface ComposeOptions {
  lang: Language
  cameraName: string
  eventType?: string
  mode?: 'first' | 'detail'
  expectation?: { kind: 'delivery' | 'visitor' | 'vehicle' | 'service'; objectType?: string | null; at: Date }
}

const FIRST_MAX_WORDS = 25
const DETAIL_MAX_WORDS = 60

const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const num = (lang: Language, n: number) => NUMBERS[lang][n] ?? String(n)
const end = (lang: Language) => (lang === 'hi' || lang === 'bn' ? '।' : '.')

function listJoin(items: string[], lang: Language) {
  const and = { en: 'and', hi: 'और', bn: 'আর', es: 'y' }[lang]
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`
}

function carried(p: Person, lang: Language) {
  const uniq = Array.from(new Set(p.carrying)).slice(0, 2)
  return uniq.map((c) => OBJECTS[lang][c] ?? OBJECTS[lang].other)
}

// ---------- English ----------
function personEn(group: Person[], hedge: boolean, detail: boolean) {
  const p = group[0]
  const n = group.length
  const noun = p.age_group === 'child' ? (n > 1 ? 'children' : 'child') : p.age_group === 'adult' ? (n > 1 ? 'adults' : 'adult') : n > 1 ? 'people' : 'person'
  const count = hedge ? num('en', n).toLowerCase() : num('en', n)
  let s = `${count} ${noun} ${p.distance === 'near' ? 'at the door' : 'further away'}`
  const items = carried(p, 'en')
  if (items.length) s += ` holding ${listJoin(items, 'en')}`
  if (detail && p.clothing) s += `, wearing ${p.clothing}`
  else if (detail && p.clothing_colour && p.clothing_colour !== 'unknown') s += `, wearing ${p.clothing_colour}`
  const motion = { toward: ', walking toward the door', away: ', walking away', passing: ', passing by', still: '', unknown: '' }[p.motion]
  s += motion
  s += { left: ', standing to your left', centre: p.distance === 'near' ? ', right in front' : ', straight ahead', right: ', to your right' }[p.position]
  return (hedge ? `Looks like ${s}` : s) + '.'
}

function vehicleEn(d: StructuredDescription) {
  if (d.vehicles.length > 2) {
    const parked = d.vehicles.filter((v) => v.motion === 'still' || v.motion === 'unknown').length
    const moving = d.vehicles.find((v) => v.motion === 'toward' || v.motion === 'away' || v.motion === 'passing')
    const far = d.vehicles.every((v) => v.distance === 'far')
    let s = `${num('en', d.vehicles.length)} vehicles ${parked === d.vehicles.length ? `are parked${far ? ' further away' : ''}` : far ? 'are in view, further away' : 'are in view'}.`
    if (moving) s += ` One ${COLOURS.en[moving.colour] ? COLOURS.en[moving.colour] + ' ' : ''}${VEHICLES.en[moving.type]} is ${moving.motion === 'toward' ? 'pulling in' : moving.motion === 'away' ? 'driving away' : 'passing'}.`
    return [s]
  }
  return d.vehicles.map((v) => {
    const colour = COLOURS.en[v.colour]
    const noun = `${colour ? colour + ' ' : ''}${VEHICLES.en[v.type]}`
    const article = /^[aeiou]/i.test(noun) ? 'An' : 'A'
    const verb = { still: 'is parked', unknown: 'is there', toward: 'is pulling in', away: 'is driving away', passing: 'is passing' }[v.motion]
    const where = { left: 'on your left', centre: 'straight ahead', right: 'on your right' }[v.position]
    return `${article} ${noun} ${verb} ${where}${v.distance === 'far' ? ', further away' : ''}.`
  })
}

function objectsEn(d: StructuredDescription) {
  return d.objects
    .filter((o) => o.type !== 'other' || o.label)
    .slice(0, 2)
    .map((o) => {
      const what = OBJECTS.en[o.type]
      const where = { left: 'on your left', centre: 'in front', right: 'on your right' }[o.position]
      return `${cap(what)} is ${o.distance === 'near' ? 'by the door' : 'further away'}, ${where}.`
    })
}

// ---------- Hindi ----------
const HI_POS = { left: 'आपकी बाईं ओर', centre: 'सामने', right: 'आपकी दाईं ओर' }
function personHi(group: Person[], hedge: boolean) {
  const p = group[0]
  const n = group.length
  const noun = p.age_group === 'child' ? (n > 1 ? 'बच्चे' : 'बच्चा') : p.age_group === 'adult' ? 'वयस्क' : 'व्यक्ति'
  const where = p.distance === 'near' ? 'दरवाज़े पर' : 'थोड़ी दूर'
  let s = `${num('hi', n)} ${noun} ${where} ${n > 1 ? 'हैं' : 'है'}`
  const items = carried(p, 'hi')
  if (items.length) s += `, हाथ में ${listJoin(items, 'hi')}`
  s += `, ${HI_POS[p.position]}`
  return (hedge ? `लगता है ${s}` : s) + '।'
}
function vehicleHi(d: StructuredDescription) {
  if (d.vehicles.length > 2) return [`${d.vehicles.length} गाड़ियाँ खड़ी हैं${d.vehicles.every((v) => v.distance === 'far') ? ', थोड़ी दूर' : ''}।`]
  return d.vehicles.map((v) => {
    const masc = v.type === 'truck'
    let colour = COLOURS.hi[v.colour] ?? ''
    if (masc && colour.endsWith('ी')) colour = colour.slice(0, -1) + 'ा'
    const verb = {
      still: masc ? 'खड़ा है' : 'खड़ी है',
      unknown: 'है',
      toward: masc ? 'आ रहा है' : 'आ रही है',
      away: masc ? 'जा रहा है' : 'जा रही है',
      passing: masc ? 'गुज़र रहा है' : 'गुज़र रही है',
    }[v.motion]
    return `एक ${colour ? colour + ' ' : ''}${VEHICLES.hi[v.type]} ${HI_POS[v.position]} ${verb}।`
  })
}

// ---------- Bengali ----------
const BN_POS = { left: 'আপনার বাঁদিকে', centre: 'সামনে', right: 'আপনার ডানদিকে' }
function personBn(group: Person[], hedge: boolean) {
  const p = group[0]
  const n = group.length
  const noun = p.age_group === 'child' ? 'শিশু' : p.age_group === 'adult' ? 'প্রাপ্তবয়স্ক' : 'ব্যক্তি'
  let s = `${num('bn', n)} ${noun} ${p.distance === 'near' ? 'দরজায় আছেন' : 'একটু দূরে আছেন'}`
  const items = carried(p, 'bn')
  if (items.length) s += `, হাতে ${listJoin(items, 'bn')}`
  s += `, ${BN_POS[p.position]}`
  return (hedge ? `মনে হচ্ছে ${s}` : s) + '।'
}
function vehicleBn(d: StructuredDescription) {
  if (d.vehicles.length > 2) return [`${d.vehicles.length}টি গাড়ি দাঁড়িয়ে আছে${d.vehicles.every((v) => v.distance === 'far') ? ', একটু দূরে' : ''}।`]
  return d.vehicles.map((v) => {
    const colour = COLOURS.bn[v.colour] ?? ''
    const verb = { still: 'দাঁড়িয়ে আছে', unknown: 'আছে', toward: 'এদিকে আসছে', away: 'চলে যাচ্ছে', passing: 'পাশ দিয়ে যাচ্ছে' }[v.motion]
    return `একটি ${colour ? colour + ' ' : ''}${VEHICLES.bn[v.type]} ${BN_POS[v.position]} ${verb}।`
  })
}

// ---------- Spanish ----------
const ES_POS = { left: 'a tu izquierda', centre: 'delante', right: 'a tu derecha' }
function personEs(group: Person[], hedge: boolean) {
  const p = group[0]
  const n = group.length
  // "Persona" is grammatically feminine and gender-neutral in meaning.
  const noun =
    p.age_group === 'child'
      ? n > 1 ? 'personas menores' : 'persona menor'
      : p.age_group === 'adult'
        ? n > 1 ? 'personas adultas' : 'persona adulta'
        : n > 1 ? 'personas' : 'persona'
  const count = hedge ? num('es', n).toLowerCase() : num('es', n)
  let s = `${count} ${noun} ${p.distance === 'near' ? 'en la puerta' : 'más lejos'}`
  const items = carried(p, 'es')
  if (items.length) s += ` con ${listJoin(items, 'es')}`
  s += `, ${ES_POS[p.position]}`
  return (hedge ? `Parece que hay ${s}` : s) + '.'
}
function vehicleEs(d: StructuredDescription) {
  if (d.vehicles.length > 2) return [`Hay ${d.vehicles.length} vehículos aparcados${d.vehicles.every((v) => v.distance === 'far') ? ' más lejos' : ''}.`]
  return d.vehicles.map((v) => {
    const g = ES_VEHICLE_GENDER[v.type] ?? 'm'
    const colour = COLOURS.es[v.colour]?.[g] ?? ''
    const art = g === 'f' ? 'Una' : 'Un'
    const verb = { still: g === 'f' ? 'aparcada' : 'aparcado', unknown: '', toward: 'acercándose', away: 'alejándose', passing: 'pasando' }[v.motion]
    return `${art} ${VEHICLES.es[v.type]}${colour ? ' ' + colour : ''}${verb ? ' ' + verb : ''} ${ES_POS[v.position]}.`
  })
}

function animalsLine(d: StructuredDescription, lang: Language) {
  const pos = { en: { left: 'on your left', centre: 'in front', right: 'on your right' }, hi: HI_POS, bn: BN_POS, es: ES_POS }[lang]
  const verb = { en: 'is', hi: 'है', bn: 'আছে', es: 'está' }[lang]
  return d.animals.slice(0, 1).map((a) =>
    lang === 'en' || lang === 'es' ? `${ANIMALS[lang][a.type]} ${verb} ${pos[a.position]}.` : `${ANIMALS[lang][a.type]} ${pos[a.position]} ${verb}${end(lang)}`
  )
}

/** People with the same age group, place and items are spoken as one group. */
function groupPeople(people: Person[]): Person[][] {
  const groups = new Map<string, Person[]>()
  for (const p of people) {
    const key = `${p.age_group}|${p.position}|${p.distance}|${[...p.carrying].sort().join(',')}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return Array.from(groups.values())
}

export function expectationLabel(kind: ComposeOptions['expectation'] extends infer E ? E extends { kind: infer K } ? K : never : never, objectType: string | null | undefined, lang: Language) {
  if (lang === 'en' && kind === 'delivery' && objectType) {
    const word = { grocery_bag: 'grocery', parcel: 'parcel', food_delivery: 'food', flowers: 'flower' }[objectType]
    if (word) return `${word} delivery`
  }
  return T.expectationWhat[kind][lang]
}

export function formatTime(d: Date, lang: Language) {
  const locale = { en: 'en-GB', hi: 'hi-IN', bn: 'bn-IN', es: 'es-ES' }[lang]
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: lang !== 'es' })
}

export function compose(d: StructuredDescription, opts: ComposeOptions): string {
  const { lang, cameraName } = opts
  const detail = opts.mode === 'detail'
  const max = detail ? DETAIL_MAX_WORDS : FIRST_MAX_WORDS
  if (d.confidence < 0.5) {
    const s = T.unsure[lang](cameraName)
    return opts.eventType === 'button_press' ? `${T.doorbell[lang]} ${s}` : s
  }
  const hedge = d.confidence < 0.8
  const clauses: string[] = []

  const groups = groupPeople(d.people)
  const personFn = { en: (g: Person[]) => personEn(g, hedge, detail), hi: (g: Person[]) => personHi(g, hedge), bn: (g: Person[]) => personBn(g, hedge), es: (g: Person[]) => personEs(g, hedge) }[lang]
  groups.slice(0, detail ? 4 : 2).forEach((g) => clauses.push(cap(personFn(g))))

  if (lang === 'en') clauses.push(...objectsEn(d))
  else
    d.objects.filter((o) => o.type !== 'other').slice(0, 1).forEach((o) => {
      const pos = { hi: HI_POS, bn: BN_POS, es: ES_POS }[lang][o.position]
      clauses.push(lang === 'es' ? `${cap(OBJECTS.es[o.type])} ${pos}.` : `${OBJECTS[lang][o.type]} ${pos}${end(lang)}`)
    })
  clauses.push(...{ en: vehicleEn, hi: vehicleHi, bn: vehicleBn, es: vehicleEs }[lang](d))
  clauses.push(...animalsLine(d, lang))
  if (detail && lang === 'en' && d.scene.summary) clauses.push(cap(d.scene.summary.replace(/\.?$/, '.')))

  const prefix: string[] = []
  if (opts.eventType === 'button_press') prefix.push(T.doorbell[lang])
  if (opts.expectation) {
    prefix.push(T.expected[lang](expectationLabel(opts.expectation.kind, opts.expectation.objectType, lang), formatTime(opts.expectation.at, lang)))
  }
  if (!clauses.length) return [...prefix, T.nothing[lang](cameraName)].join(' ')

  // Add clauses in priority order until the word budget is used up.
  const out = [...prefix]
  let budget = max - words(out.join(' '))
  for (const c of clauses) {
    if (words(c) <= budget || out.length === prefix.length) {
      out.push(c)
      budget -= words(c)
    }
  }
  return out.join(' ')
}

/** Sentences that do not need a vision model: device status and sensor events. */
export function composeStatus(type: string, lang: Language, cameraName: string) {
  if (type === 'device_offline') return T.offline[lang](cameraName)
  if (type === 'device_online') return T.online[lang](cameraName)
  return T.sensor[lang](type.replace(/_/g, ' '))
}
