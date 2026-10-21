import { StructuredDescription, StructuredDescriptionSchema, Stage1Result } from '../pipeline/types'
import {
  ADDRESS_PATTERN,
  BODY_PERSON_PATTERN,
  BRAND_ALLOWLIST,
  CAPITALISED_PAIR,
  COLOUR_PERSON_PATTERN,
  COMMON_GIVEN_NAMES,
  CONTEXT_ONLY_BODY,
  FIRE_CATEGORIES,
  ForbiddenCategory,
  NAME_CUE_PATTERN,
  NEUTRAL_REWRITES,
  PLATE_PATTERNS,
  WORD_LISTS,
} from './lexicon'

export type LayerName = 'schema' | 'forbidden' | 'judgment' | 'plausibility' | 'fallback'

export interface LayerReport {
  layer: LayerName
  status: 'pass' | 'modified' | 'fired' | 'skipped'
  notes: string[]
}

export interface JudgmentVerdict {
  flagged: boolean
  source: string // 'bedrock-guardrails' | 'nova-micro-classifier' | 'unavailable'
  reason?: string
}

export interface GuardContext {
  cameraName: string
  /** 'outdoor' cameras may see vehicles; 'indoor' ones should not. */
  cameraKind?: 'outdoor' | 'indoor'
  /** Confirmed categories seen on this camera in the last 7 days, e.g. { person: 14, vehicle: 3 }. */
  history?: Partial<Record<'person' | 'package' | 'vehicle' | 'animal', number>>
  stage1?: Pick<Stage1Result, 'person' | 'vehicle' | 'animal' | 'package' | 'provider'>
  judgment?: JudgmentVerdict
  /** OCR text is only allowed when the user explicitly asked to read a sign or label. */
  allowText?: boolean
}

export interface GuardResult {
  ok: boolean
  fired: boolean
  firedBy?: LayerName
  description?: StructuredDescription
  confidence: number
  layers: LayerReport[]
  fallbackText?: string
  suppressed?: string
}

export interface TextFinding {
  category: ForbiddenCategory
  match: string
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const WORD_REGEX: Array<[ForbiddenCategory, RegExp]> = Object.entries(WORD_LISTS).flatMap(([cat, words]) =>
  words
    .filter((w) => !CONTEXT_ONLY_BODY.has(w))
    .map((w) => [cat as ForbiddenCategory, new RegExp(`(?<![\\w-])${escape(w)}(?![\\w-])`, 'i')] as [ForbiddenCategory, RegExp])
)

/** Rewrites gendered job words to neutral ones ("mailman" -> "mail carrier"). */
export function neutralise(text: string): string {
  let out = text
  for (const [from, to] of Object.entries(NEUTRAL_REWRITES)) {
    out = out.replace(new RegExp(`\\b${escape(from)}\\b`, 'gi'), to)
  }
  return out
}

function looksLikePersonName(text: string): string | null {
  const cue = text.match(NAME_CUE_PATTERN)
  if (cue) return cue[0]
  for (const m of Array.from(text.matchAll(CAPITALISED_PAIR))) {
    const words = m[0].split(/\s+/)
    if (words.every((w) => BRAND_ALLOWLIST.has(w.toLowerCase()))) continue
    // A capitalised pair is a name if either word is a known given name, or neither is a brand word.
    if (words.some((w) => COMMON_GIVEN_NAMES.has(w.toLowerCase())) || words.every((w) => !BRAND_ALLOWLIST.has(w.toLowerCase())))
      return m[0]
  }
  for (const token of text.split(/[^A-Za-z]+/)) {
    if (token.length > 1 && /^[A-Z]/.test(token) && COMMON_GIVEN_NAMES.has(token.toLowerCase())) return token
  }
  return null
}

/** Scans one free-text string. Exported so the narration composer can double-check its output. */
export function scanText(text: string, opts: { ocr?: boolean } = {}): TextFinding[] {
  const findings: TextFinding[] = []
  if (!text) return findings
  if (!opts.ocr) {
    for (const [cat, re] of WORD_REGEX) {
      const m = text.match(re)
      if (m) findings.push({ category: cat, match: m[0] })
    }
    const cp = text.match(COLOUR_PERSON_PATTERN)
    if (cp) findings.push({ category: 'race_ethnicity', match: cp[0] })
    const bp = text.match(BODY_PERSON_PATTERN)
    if (bp) findings.push({ category: 'body', match: bp[0] })
  }
  const name = looksLikePersonName(text)
  if (name) findings.push({ category: 'personal_name', match: name })
  for (const re of PLATE_PATTERNS) {
    const m = text.match(re)
    if (m) {
      findings.push({ category: 'plate_or_id', match: m[0] })
      break
    }
  }
  const addr = text.match(ADDRESS_PATTERN)
  if (addr) findings.push({ category: 'address', match: addr[0] })
  return findings
}

function collectUnknownKeys(raw: unknown, parsed: unknown, path = ''): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((r, i) => collectUnknownKeys(r, parsed[i], `${path}[${i}]`))
  }
  if (raw && typeof raw === 'object' && parsed && typeof parsed === 'object') {
    const out: string[] = []
    for (const k of Object.keys(raw as object)) {
      const p = path ? `${path}.${k}` : k
      if (!(k in (parsed as object))) out.push(p)
      else out.push(...collectUnknownKeys((raw as any)[k], (parsed as any)[k], p))
    }
    return out
  }
  return []
}

/** Layer 1: the model must return one JSON object in our schema and nothing else. */
export function parseModelOutput(raw: unknown): { ok: true; value: StructuredDescription; dropped: string[] } | { ok: false; error: string } {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('{')) return { ok: false, error: 'output is not a JSON object (free text rejected)' }
    try {
      obj = JSON.parse(trimmed)
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${(e as Error).message}` }
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'output is not a JSON object' }
  const res = StructuredDescriptionSchema.safeParse(obj)
  if (!res.success) {
    return { ok: false, error: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') }
  }
  return { ok: true, value: res.data, dropped: collectUnknownKeys(obj, res.data) }
}

type FreeTextRef = { path: string; get: () => string | undefined; set: (v: string | undefined) => void; ocr?: boolean }

function freeTextFields(d: StructuredDescription): FreeTextRef[] {
  const refs: FreeTextRef[] = []
  d.people.forEach((p, i) =>
    refs.push({ path: `people[${i}].clothing`, get: () => p.clothing, set: (v) => (p.clothing = v) })
  )
  d.objects.forEach((o, i) => refs.push({ path: `objects[${i}].label`, get: () => o.label, set: (v) => (o.label = v) }))
  refs.push({ path: 'scene.setting', get: () => d.scene.setting, set: (v) => (d.scene.setting = v) })
  refs.push({ path: 'scene.summary', get: () => d.scene.summary, set: (v) => (d.scene.summary = v) })
  refs.push({ path: 'answer', get: () => d.answer, set: (v) => (d.answer = v) })
  return refs
}

/** Layer 2: drop or rewrite any field that carries a forbidden attribute. Fires on judgment or identity. */
function forbiddenFilter(d: StructuredDescription, ctx: GuardContext): { report: LayerReport; fire: boolean } {
  const notes: string[] = []
  let fire = false
  for (const ref of freeTextFields(d)) {
    const original = ref.get()
    if (!original) continue
    const rewritten = neutralise(original)
    if (rewritten !== original) {
      ref.set(rewritten)
      notes.push(`${ref.path}: rewrote "${original}" -> "${rewritten}"`)
    }
    const findings = scanText(rewritten)
    if (findings.length) {
      ref.set(undefined)
      const cats = Array.from(new Set(findings.map((f) => f.category)))
      notes.push(`${ref.path}: dropped (${cats.join(', ')}: "${findings[0].match}")`)
      if (findings.some((f) => FIRE_CATEGORIES.includes(f.category))) fire = true
    }
  }
  // OCR text: never read names, addresses, plates or ID numbers; only kept when the user asked.
  const keptText: string[] = []
  d.text_seen.forEach((t, i) => {
    if (!ctx.allowText) {
      notes.push(`text_seen[${i}]: dropped (not requested)`)
      return
    }
    const findings = scanText(t, { ocr: true })
    if (findings.length) notes.push(`text_seen[${i}]: withheld (${findings.map((f) => f.category).join(', ')})`)
    else keptText.push(t)
  })
  d.text_seen = Array.from(new Set(keptText.map((t) => t.trim()))) // the same sign painted three times is read once
  return {
    report: { layer: 'forbidden', status: fire ? 'fired' : notes.length ? 'modified' : 'pass', notes },
    fire,
  }
}

const countOf = (d: StructuredDescription) => ({
  person: d.people.length,
  package: d.objects.filter((o) => /parcel|bag|envelope|food/.test(o.type)).length,
  vehicle: d.vehicles.length,
  animal: d.animals.length,
})

/** Layer 4: compare the claim with the camera, the cheap detector and recent history. */
function plausibility(d: StructuredDescription, ctx: GuardContext): { report: LayerReport; confidence: number; fire: boolean } {
  const notes: string[] = []
  let confidence = d.confidence
  let fire = false
  const c = countOf(d)
  const total = c.person + c.package + c.vehicle + c.animal

  if (c.person > 8) {
    notes.push(`${c.person} people at a ${ctx.cameraName} camera is implausible`)
    confidence = Math.min(confidence, 0.45)
  }
  if (total > 20) {
    notes.push(`${total} entities is beyond what one camera frame supports`)
    fire = true
  }
  if (ctx.cameraKind === 'indoor' && c.vehicle > 0) {
    notes.push('vehicle reported on an indoor camera')
    fire = true
  }
  if (ctx.stage1 && ctx.stage1.provider !== 'none') {
    if (c.person > 0 && ctx.stage1.person < 0.2) {
      notes.push(`model sees ${c.person} person(s) but Stage 1 (${ctx.stage1.provider}) saw none`)
      confidence = Math.min(confidence, 0.6)
    }
    if (c.vehicle > 0 && ctx.stage1.vehicle < 0.2 && ctx.stage1.person < 0.2) {
      notes.push('vehicle not confirmed by Stage 1')
      confidence = Math.min(confidence, 0.6)
    }
  }
  if (ctx.history) {
    for (const k of ['person', 'package', 'vehicle', 'animal'] as const) {
      if (c[k] > 0 && (ctx.history[k] ?? 0) === 0 && Object.values(ctx.history).some((v) => (v ?? 0) > 5)) {
        notes.push(`first ${k} on this camera in 7 days: treated as low confidence until confirmed`)
        confidence = Math.min(confidence, 0.7)
      }
    }
  }
  if (total === 0 && confidence > 0.5 && !d.answer && !d.text_seen.length) {
    notes.push('no entities but high confidence; capped')
    confidence = 0.5
  }
  return {
    report: { layer: 'plausibility', status: fire ? 'fired' : notes.length ? 'modified' : 'pass', notes },
    confidence,
    fire,
  }
}

export function fallbackSentence(cameraName: string) {
  return `Motion detected at ${cameraName}.`
}

/**
 * The safety layer. Pure: same input, same output, no I/O. The async judgment check
 * runs before this and is passed in through ctx.judgment so it can be tested too.
 */
export function guard(raw: unknown, ctx: GuardContext): GuardResult {
  const layers: LayerReport[] = []
  const suppressed = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const fail = (layer: LayerName): GuardResult => {
    layers.push({ layer: 'fallback', status: 'fired', notes: [`fallback spoken because ${layer} fired`] })
    return {
      ok: false,
      fired: true,
      firedBy: layer,
      confidence: 0,
      layers,
      fallbackText: fallbackSentence(ctx.cameraName),
      suppressed,
    }
  }

  // 1. Schema
  const parsed = parseModelOutput(raw)
  if (!parsed.ok) {
    layers.push({ layer: 'schema', status: 'fired', notes: [parsed.error] })
    return fail('schema')
  }
  const d = parsed.value
  layers.push({
    layer: 'schema',
    status: parsed.dropped.length ? 'modified' : 'pass',
    notes: parsed.dropped.map((p) => `unknown field dropped: ${p}`),
  })
  // Unknown keys are dropped by the schema, but if their *content* was forbidden the model was judging.
  const droppedText = parsed.dropped
    .map((p) => p.split(/[.[\]]/).filter(Boolean).reduce<any>((o, k) => (o == null ? o : o[k]), typeof raw === 'string' ? JSON.parse(raw) : raw))
    .filter((v) => typeof v === 'string') as string[]
  const droppedFindings = droppedText.flatMap((t) => scanText(t))
  if (droppedFindings.some((f) => FIRE_CATEGORIES.includes(f.category))) {
    layers.push({
      layer: 'forbidden',
      status: 'fired',
      notes: [`judgment in an unknown field: "${droppedFindings[0].match}" (${droppedFindings[0].category})`],
    })
    return fail('forbidden')
  }

  // 2. Forbidden attributes
  const f = forbiddenFilter(d, ctx)
  layers.push(f.report)
  if (f.fire) return fail('forbidden')

  // 3. Judgment / toxicity (computed upstream, asynchronously)
  if (!ctx.judgment) layers.push({ layer: 'judgment', status: 'skipped', notes: ['no judgment check available'] })
  else if (ctx.judgment.flagged) {
    layers.push({ layer: 'judgment', status: 'fired', notes: [`${ctx.judgment.source}: ${ctx.judgment.reason || 'flagged'}`] })
    return fail('judgment')
  } else layers.push({ layer: 'judgment', status: 'pass', notes: [`${ctx.judgment.source}: clean`] })

  // 4. Plausibility
  const p = plausibility(d, ctx)
  layers.push(p.report)
  if (p.fire) return fail('plausibility')

  layers.push({ layer: 'fallback', status: 'skipped', notes: [] })
  return { ok: true, fired: false, description: { ...d, confidence: p.confidence }, confidence: p.confidence, layers }
}

/**
 * Final belt-and-braces check on any sentence about to be spoken. Camera names are
 * user-chosen ("Playground Device") and would trip the name check, so they are
 * removed before scanning.
 */
export function isSpeakable(sentence: string, safePhrases: string[] = []): boolean {
  let s = sentence
  for (const p of safePhrases.filter(Boolean)) s = s.replace(new RegExp(escape(p), 'gi'), ' ')
  return scanText(s).length === 0
}
