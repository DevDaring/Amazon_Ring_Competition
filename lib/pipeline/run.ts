import { config } from '../config'
import { fallbackSentence, guard, GuardContext, isSpeakable, JudgmentVerdict } from '../guardrails/guard'
import { compose, composeStatus } from '../narration/composer'
import { T } from '../narration/i18n'
import { providers, withFallback } from '../providers/registry'
import { Announcement, publish } from '../server/bus'
import { db } from '../server/db'
import { getDevice } from '../server/devices'
import { confirmedHistory, correctionPriors } from '../server/history'
import { cameraName, getSettings } from '../server/settings'
import { removeFile, saveFile } from '../server/storage'

const removeAudio = (name: string) => removeFile('audio', name)
import { acquireFrames } from './acquire'
import { applyPrivacyZones, selectFrames } from './frames'
import { Spoken, synthesize } from './speech'
import { stage0 } from './stage0'
import { confirmExpectation, ExpectationLite, stage2 } from './stage2'
import { runStage3 } from './stage3'
import type { Language, Stage1Result, StageMetric, StructuredDescription } from './types'

const NO_DETECTION: Stage1Result = { person: 0.5, package: 0.5, vehicle: 0.5, animal: 0.5, detections: [], empty: false, provider: 'none' }

/** Layer 3 of the guardrails. If no checker is reachable the layer is reported as skipped, never silently passed. */
export async function judge(text: string): Promise<{ verdict?: JudgmentVerdict; costUsd: number; latencyMs: number }> {
  try {
    const { result, provider } = await withFallback('judgment', providers().judgment, (p) => p.check(text))
    return { verdict: { flagged: result.flagged, reason: result.reason, source: provider }, costUsd: result.costUsd, latencyMs: result.latencyMs }
  } catch {
    return { verdict: undefined, costUsd: 0, latencyMs: 0 }
  }
}

export async function processEvent(eventId: string, extras: { uploadName?: string | null } = {}) {
  const t0 = Date.now()
  const ev = await db.event.findUnique({ where: { id: eventId } })
  if (!ev) return
  const settings = await getSettings()
  const lang = settings.language as Language
  const stages: StageMetric[] = []
  let cost = 0
  const emit = (m: StageMetric) => {
    stages.push(m)
    cost += m.cost_estimate ?? 0
    publish({ kind: 'stage', eventId, ...m })
  }
  const device = await getDevice(ev.deviceId)
  const cam = cameraName(settings, ev.deviceId, device?.name ?? ev.cameraName)
  await db.event.update({ where: { id: eventId }, data: { status: 'processing', cameraName: cam } })

  const finish = async (data: Record<string, unknown>) => {
    await db.event.update({
      where: { id: eventId },
      data: { stagesJson: JSON.stringify(stages), totalMs: Date.now() - t0, costUsd: cost, language: lang, ...data },
    })
    publish({ kind: 'metrics' })
  }

  const announce = async (
    text: string,
    extra: { confidence?: number | null; guardFired?: boolean; urgency?: string; category?: string; source?: Announcement['source'] } = {},
    presynth?: Promise<Spoken>
  ) => {
    const s = Date.now()
    const spoken = presynth ? await presynth : await synthesize(extra.source === 'early' ? `${eventId}-early` : eventId, text, lang)
    emit({ stage: 'speech', status: spoken.audioUrl ? 'passed' : 'error', latency_ms: Date.now() - s, model_used: spoken.voice ? `${spoken.provider}:${spoken.voice}` : spoken.provider, cost_estimate: spoken.costUsd, note: spoken.error })
    const a: Announcement = {
      id: extra.source === 'early' ? `${eventId}-early` : eventId,
      source: extra.source ?? 'event',
      text,
      language: lang,
      audioUrl: spoken.audioUrl,
      ttsProvider: spoken.provider,
      urgency: extra.urgency ?? 'normal',
      category: extra.category ?? 'motion',
      confidence: extra.confidence ?? null,
      simulated: ev.simulated,
      guardFired: Boolean(extra.guardFired),
      cameraName: cam,
      at: new Date().toISOString(),
    }
    publish({ kind: 'announcement', announcement: a })
    return spoken
  }

  // ---- Stage 0: subtype gate (free)
  let s = Date.now()
  const s0 = stage0(ev.type, ev.subType, settings)
  emit({ stage: 'stage0', status: s0.route === 'vision' ? 'passed' : 'stopped', latency_ms: Date.now() - s, note: s0.reason })
  if (s0.route === 'admin') return finish({ status: 'silent' })
  if (s0.route === 'status') {
    const text = composeStatus(ev.type, lang, cam)
    const spoken = await announce(text, { category: s0.category })
    return finish({ status: 'announced', narration: text, ttsProvider: spoken.provider, audioPath: spoken.audioUrl })
  }

  // ---- Encrypted cameras cannot be described; say so instead of failing.
  if (device?.e2ee) {
    emit({ stage: 'frames', status: 'stopped', latency_ms: 0, note: 'end-to-end encrypted device: media not available to partners' })
    const text = T.e2ee[lang](cam)
    const spoken = s0.announce ? await announce(text, { category: s0.category }) : null
    return finish({ status: s0.announce ? 'announced' : 'silent', narration: text, ttsProvider: spoken?.provider })
  }

  // ---- Frame selection (CPU)
  s = Date.now()
  const acq = await acquireFrames({ deviceId: ev.deviceId, timestampMs: ev.receivedAt.getTime(), simulated: ev.simulated, uploadName: extras.uploadName })
  const sel = await selectFrames(acq.frames, 3)
  const zones = device?.privacyZones ?? []
  const kept = await Promise.all(sel.kept.map(async (f) => ({ ...f, buf: await applyPrivacyZones(f.buf, zones) })))
  emit({
    stage: 'frames',
    status: kept.length ? 'passed' : 'stopped',
    latency_ms: Date.now() - s,
    note: [
      ...acq.notes,
      kept[0] ? `best: ${kept[0].label} (sharpness ${kept[0].sharpness?.toFixed(0)}, brightness ${kept[0].brightness?.toFixed(0)})` : '',
      ...sel.dropped.map((d) => `dropped: ${d.reason}`),
      zones.length ? `${zones.length} privacy zone(s) masked` : '',
    ].filter(Boolean).join('; '),
  })
  if (!kept.length) {
    const text = T.noFrame[lang](cam)
    const spoken = s0.announce ? await announce(text, { category: s0.category, urgency: s0.priority }) : null
    return finish({ status: s0.announce ? 'announced' : 'silent', narration: text, ttsProvider: spoken?.provider })
  }
  const best = kept[0]
  const framePath = `${eventId}.jpg`
  saveFile('frames', framePath, best.buf)
  await db.event.update({ where: { id: eventId }, data: { framePath, frameSource: best.label } })

  // Stage 1 can never stop a doorbell press, nor an event Ring itself classified as
  // human/vehicle (see below), so for those Stage 3 starts now, in parallel, to stay
  // inside the response target. Stage 2 can still silence them; the speculative
  // answer is then discarded and its cost recorded.
  const ringClassified = ev.type === 'motion_detected' && (ev.subType === 'human' || ev.subType === 'vehicle')
  const speculative = (ev.type === 'button_press' || ringClassified) && s0.announce
    ? runStage3(kept.map((f) => f.buf), 'narrate', { eventType: ev.type }).catch((e: Error) => e)
    : null
  // If a later gate stops the event, the speculative call still cost money: record it.
  const discardSpeculative = async (why: string) => {
    if (!speculative) return
    const r = await speculative
    if (!(r instanceof Error)) emit({ stage: 'stage3', status: 'skipped', latency_ms: 0, model_used: r.call.model, cost_estimate: r.totalCost, note: `speculative answer discarded: ${why}` })
  }

  // ---- Stage 1: object gate (cheap)
  s = Date.now()
  let s1: Stage1Result = NO_DETECTION
  let s1Cost = 0
  try {
    const r = await withFallback('stage1-detector', providers().detector, (p) => p.detect(best.buf))
    s1 = r.result
    s1Cost = r.result.costUsd
    if (r.attempts.some((a) => !a.ok)) s1 = { ...s1, provider: `${s1.provider} (after ${r.attempts.filter((a) => !a.ok).map((a) => a.provider).join(', ')} failed)` }
  } catch (e) {
    s1 = { ...NO_DETECTION, provider: 'none' }
  }
  // Ring's own subtype is a detection too. If Ring said human/vehicle and Stage 1 saw
  // nothing, the two detectors disagree: continue (at low urgency) rather than drop a
  // real visitor because one cheap model was unsure. Generic motion with an empty frame stops.
  const ringSaw = ev.subType === 'human' || ev.subType === 'vehicle'
  const empty = s1.empty && ev.type !== 'button_press' && !ringSaw
  emit({
    stage: 'stage1',
    status: empty ? 'stopped' : 'passed',
    latency_ms: Date.now() - s,
    model_used: s1.provider,
    confidence: Math.max(s1.person, s1.package, s1.vehicle, s1.animal),
    cost_estimate: s1Cost,
    note: `person ${s1.person.toFixed(2)}, package ${s1.package.toFixed(2)}, vehicle ${s1.vehicle.toFixed(2)}, animal ${s1.animal.toFixed(2)}${empty ? ' -> empty frame, stop' : s1.empty && ringSaw ? ` -> nothing found, but Ring classified this as ${ev.subType}; continuing` : ''}`,
  })
  await db.event.update({ where: { id: eventId }, data: { stage1Json: JSON.stringify(s1) } })
  if (empty) {
    await discardSpeculative('Stage 1 found an empty frame')
    return finish({ status: 'silent' })
  }

  // ---- Stage 2: preference model (cheap)
  s = Date.now()
  const pending = await db.expectation.findMany({ where: { status: 'pending' } })
  const expectations: ExpectationLite[] = pending.map((e) => ({ ...e, kind: e.kind as ExpectationLite['kind'] }))
  const s2 = stage2({ stage0: s0, stage1: s1, settings, deviceId: ev.deviceId, now: new Date(), expectations, priors: await correctionPriors() })
  emit({ stage: 'stage2', status: s2.speak ? 'passed' : 'stopped', latency_ms: Date.now() - s, note: s2.reasons.join('; ') || `speak, urgency ${s2.urgency}` })
  await db.event.update({ where: { id: eventId }, data: { stage2Json: JSON.stringify(s2), urgency: s2.urgency } })
  if (!s2.speak) {
    await discardSpeculative('Stage 2 decided not to speak')
    return finish({ status: 'silent' })
  }

  if (s2.earlyAlert) {
    const what = T.earlyWhat[s2.dominant][lang]
    await announce(T.early[lang](what, cam), { urgency: 'gentle', category: s0.category, source: 'early' })
  }

  // ---- Stage 3: vision LLM ($$$)
  s = Date.now()
  let raw = ''
  let model = 'none'
  try {
    const spec = speculative ? await speculative : null
    if (spec instanceof Error) throw spec
    const r3 = spec ?? (await runStage3(kept.map((f) => f.buf), 'narrate', { eventType: ev.type }))
    raw = r3.raw
    model = `${r3.call.provider}:${r3.call.model}${r3.escalated ? ' (escalated)' : ''}`
    let conf: number | undefined
    try {
      conf = JSON.parse(raw).confidence
    } catch {
      conf = undefined
    }
    const failures = r3.attempts.filter((a) => !a.ok).map((a) => `${a.provider} failed: ${a.error}`)
    if (spec) failures.unshift(ev.type === 'button_press' ? 'started in parallel with Stage 1 (doorbell presses are never gated)' : 'started in parallel with Stage 1 (Ring already classified this event)')
    emit({ stage: 'stage3', status: 'passed', latency_ms: spec ? r3.attempts.reduce((t, a) => t + a.ms, 0) : Date.now() - s, model_used: model, confidence: conf, cost_estimate: r3.totalCost, note: failures.join('; ') || undefined })
  } catch (e) {
    emit({ stage: 'stage3', status: 'error', latency_ms: Date.now() - s, note: (e as Error).message.slice(0, 300) })
    raw = '' // falls through to the guardrail fallback
  }

  // ---- Guardrails (required). Layers 1, 2 and 4 are pure; layer 3 runs in parallel with TTS.
  s = Date.now()
  const ctx: GuardContext = {
    cameraName: cam,
    cameraKind: settings.cameras[ev.deviceId ?? '']?.kind ?? 'outdoor',
    history: await confirmedHistory(ev.deviceId),
    stage1: s1,
  }
  const pre = guard(raw, ctx)
  let description: StructuredDescription | undefined = pre.description
  let matched: ExpectationLite | undefined
  if (description) matched = expectations.find((e) => s2.expectationCandidates.includes(e.id) && confirmExpectation(e, description!))
  const draft = description
    ? compose(description, { lang, cameraName: cam, eventType: ev.type, expectation: matched ? { kind: matched.kind, objectType: matched.objectType, at: new Date() } : undefined })
    : null

  // Audio for the draft is synthesised while layer 3 runs, but it is only released
  // below if every layer passes; otherwise it is discarded and the fallback is spoken.
  const draftOk = Boolean(pre.ok && draft && isSpeakable(draft, [cam]))
  const ttsDraft = draftOk ? synthesize(eventId, draft!, lang) : null
  const jr = raw ? await judge(raw) : { verdict: undefined, costUsd: 0, latencyMs: 0 }
  const final = guard(raw, { ...ctx, judgment: jr.verdict })
  let text: string
  let fired = final.fired
  if (final.ok && draftOk) {
    text = draft!
  } else {
    if (final.ok && draft) fired = true // composer output failed the last check
    text = lang === 'en' ? fallbackSentence(cam) : T.fallback[lang](cam)
    if (ev.type === 'button_press') text = `${T.doorbell[lang]} ${text}`
    // Never keep audio of a rejected sentence on disk.
    if (ttsDraft) {
      const d = await ttsDraft
      if (d.audioUrl) removeAudio(d.audioUrl.split('/').pop()!)
    }
  }
  emit({
    stage: 'guardrails',
    status: fired ? 'fired' : 'passed',
    latency_ms: Date.now() - s,
    confidence: final.confidence,
    cost_estimate: jr.costUsd,
    model_used: jr.verdict?.source ?? 'local rules only',
    note: final.layers.map((l) => `${l.layer}: ${l.status}${l.notes.length ? ` (${l.notes.join('; ')})` : ''}`).join(' | '),
  })

  // ---- Narration + speech
  emit({ stage: 'narration', status: 'passed', latency_ms: 0, note: `${text.split(/\s+/).length} words, ${lang}` })
  const spoken = await announce(
    text,
    { confidence: final.confidence, guardFired: fired, urgency: s2.urgency, category: s2.dominant === 'none' ? s0.category : s2.dominant },
    text === draft && ttsDraft ? ttsDraft : undefined
  )

  if (matched && !fired) {
    await db.expectation.update({ where: { id: matched.id }, data: { status: 'met', matchedEventId: eventId, matchedAt: new Date() } })
  }
  return finish({
    status: 'announced',
    narration: text,
    confidence: final.confidence,
    modelUsed: model,
    guardFired: fired,
    descriptionJson: final.description ? JSON.stringify(final.description) : null,
    guardJson: JSON.stringify({ layers: final.layers, suppressed: fired ? final.suppressed ?? draft : undefined, judgment: jr.verdict ?? null }),
    ttsProvider: spoken.provider,
    audioPath: spoken.audioUrl,
  })
}

export function demoModeOn() {
  return config().DEMO_MODE
}
