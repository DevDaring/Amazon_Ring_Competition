import type { Stage0Result } from './stage0'
import type { Stage1Result, StructuredDescription } from './types'
import type { Settings } from '../server/settings'
import { inQuietHours } from '../server/settings'

// Stage 2 decides whether to speak and how urgently. It is rules plus a tiny
// "embedding": each event becomes a 7-number vector of what Stage 1 saw and when.
// Events too similar to ones the user marked "Wrong" on the same camera are silenced.

export interface CorrectionPrior {
  deviceId: string | null
  verdict: 'correct' | 'wrong' | 'mute'
  category: string
  vector: number[]
}

export interface ExpectationLite {
  id: string
  text: string
  kind: 'delivery' | 'visitor' | 'vehicle' | 'service'
  objectType?: string | null
  vehicleColour?: string | null
  vehicleType?: string | null
  windowStart: Date
  windowEnd: Date
}

export interface Stage2Input {
  stage0: Stage0Result
  stage1: Stage1Result
  settings: Settings
  deviceId: string | null
  now: Date
  expectations: ExpectationLite[]
  priors: CorrectionPrior[]
}

export interface Stage2Result {
  speak: boolean
  urgency: 'high' | 'normal' | 'gentle' | 'silent'
  earlyAlert: boolean
  reasons: string[]
  expectationCandidates: string[]
  similarWrong: number
  vector: number[]
  dominant: 'person' | 'package' | 'vehicle' | 'animal' | 'none'
}

export function embed(s1: Pick<Stage1Result, 'person' | 'package' | 'vehicle' | 'animal' | 'detections'>, at: Date): number[] {
  const hour = at.getHours() + at.getMinutes() / 60
  const people = s1.detections.filter((d) => d.category === 'person').length
  return [
    s1.person,
    s1.package,
    s1.vehicle,
    s1.animal,
    0.5 * Math.sin((2 * Math.PI * hour) / 24),
    0.5 * Math.cos((2 * Math.PI * hour) / 24),
    Math.min(people, 5) / 5,
  ]
}

export function cosine(a: number[], b: number[]) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export function dominantCategory(s1: Pick<Stage1Result, 'person' | 'package' | 'vehicle' | 'animal'>): Stage2Result['dominant'] {
  const entries = (['person', 'package', 'vehicle', 'animal'] as const).map((k) => [k, s1[k]] as const)
  const [k, v] = entries.reduce((a, b) => (b[1] > a[1] ? b : a))
  return v >= 0.5 ? k : 'none'
}

const inWindow = (e: ExpectationLite, now: Date) =>
  now.getTime() >= e.windowStart.getTime() - 30 * 60_000 && now.getTime() <= e.windowEnd.getTime()

export function stage2(input: Stage2Input): Stage2Result {
  const { stage0, stage1, settings, deviceId, now } = input
  const reasons: string[] = []
  const vector = embed(stage1, now)
  const dominant = dominantCategory(stage1)
  let speak = stage0.announce
  let urgency: Stage2Result['urgency'] = stage0.priority === 'high' ? 'high' : 'normal'
  if (!stage0.announce) reasons.push(`announcements for ${stage0.category} are off in Settings`)

  // Announce-what toggles for what Stage 1 actually found.
  if (dominant === 'animal' && !settings.announce.animal) {
    speak = false
    reasons.push('animal announcements are off')
  }
  if (dominant === 'package' && !settings.announce.package && stage0.category !== 'doorbell') {
    speak = false
    reasons.push('package announcements are off')
  }

  // "Mute this type" taps.
  const muted = settings.mutes.find((m) => (m.deviceId === deviceId || m.deviceId === '*') && (m.category === dominant || m.category === stage0.category))
  if (muted && stage0.category !== 'doorbell') {
    speak = false
    reasons.push(`muted: ${muted.category} on this camera`)
  }

  // Similar to events the user said were wrong?
  const wrong = input.priors.filter((p) => p.verdict === 'wrong' && (p.deviceId === deviceId || !p.deviceId))
  const similarWrong = wrong.filter((p) => cosine(p.vector, vector) > 0.97).length
  if (similarWrong >= 2 && stage0.category !== 'doorbell') {
    speak = false
    reasons.push(`${similarWrong} similar events on this camera were marked wrong`)
  }
  const confirmed = input.priors.filter((p) => p.verdict === 'correct' && p.category === dominant && p.deviceId === deviceId).length
  if (confirmed >= 3) reasons.push(`${confirmed} confirmed ${dominant} events on this camera raise trust`)

  // Expectations: the preliminary match uses Stage 1 only; Stage 3 confirms details.
  const candidates = input.expectations.filter((e) => {
    if (!inWindow(e, now)) return false
    if (e.kind === 'vehicle') return stage1.vehicle >= 0.5
    if (e.kind === 'delivery') return stage1.package >= 0.4 || stage1.person >= 0.5 || stage1.vehicle >= 0.5
    return stage1.person >= 0.5
  })
  if (candidates.length) {
    reasons.push(`may match expectation: ${candidates.map((c) => c.text).join('; ')}`)
    speak = true // an expected arrival is always worth a sentence
  }

  // Quiet hours: unexpected events get a gentler but earlier alert.
  if (inQuietHours(settings, now) && speak) {
    if (!candidates.length && stage0.category !== 'doorbell') {
      urgency = 'gentle'
      reasons.push('quiet hours: gentle early alert')
      return { speak, urgency, earlyAlert: true, reasons, expectationCandidates: [], similarWrong, vector, dominant }
    }
  }
  if (!speak) urgency = 'silent'
  return { speak, urgency, earlyAlert: false, reasons, expectationCandidates: candidates.map((c) => c.id), similarWrong, vector, dominant }
}

/** After Stage 3: does the described scene really fit the expectation? Never matches a person to a named individual. */
export function confirmExpectation(e: ExpectationLite, d: StructuredDescription): boolean {
  if (e.kind === 'vehicle') {
    return d.vehicles.some(
      (v) => (!e.vehicleColour || v.colour === e.vehicleColour) && (!e.vehicleType || v.type === e.vehicleType)
    )
  }
  if (e.kind === 'delivery') {
    const items = [...d.objects.map((o) => o.type), ...d.people.flatMap((p) => p.carrying)] as string[]
    if (!e.objectType) return items.length > 0 || d.people.length > 0
    const want = e.objectType
    const related: Record<string, string[]> = {
      grocery_bag: ['grocery_bag', 'bag'],
      parcel: ['parcel', 'flat_parcel', 'envelope'],
      food_delivery: ['food_delivery', 'bag'],
      flowers: ['flowers'],
    }
    return items.some((i) => (related[want] ?? [want]).includes(i))
  }
  return d.people.length > 0
}
