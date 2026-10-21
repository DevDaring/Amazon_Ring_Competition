import crypto from 'node:crypto'
import { guard, isSpeakable } from '../guardrails/guard'
import { compose } from '../narration/composer'
import { T } from '../narration/i18n'
import { acquireFrames } from '../pipeline/acquire'
import { applyPrivacyZones, selectFrames } from '../pipeline/frames'
import { judge } from '../pipeline/run'
import { synthesize } from '../pipeline/speech'
import { runStage3, Stage3Intent } from '../pipeline/stage3'
import type { Frame, Language, Stage1Result, StageMetric, StructuredDescription } from '../pipeline/types'
import { providers, withFallback } from '../providers/registry'
import { Announcement, publish } from '../server/bus'
import { db } from '../server/db'
import { getDevice } from '../server/devices'
import { recentFrames } from '../server/frame-cache'
import { cameraName, getSettings } from '../server/settings'
import { readFile } from '../server/storage'
import { INTENT_ROUTE, classifyQuestion, Intent } from './intent'

export interface AskResult {
  id: string
  question: string
  intent: Intent
  answer: string
  audioUrl: string | null
  ttsProvider: string
  stages: StageMetric[]
  frameSource: string | null
  guardFired: boolean
}

const POS: Record<Language, Record<string, string>> = {
  en: { left: ' on your left', centre: ' in front', right: ' on your right' },
  hi: { left: ', आपकी बाईं ओर', centre: ', सामने', right: ', आपकी दाईं ओर' },
  bn: { left: ', আপনার বাঁদিকে', centre: ', সামনে', right: ', আপনার ডানদিকে' },
  es: { left: ' a tu izquierda', centre: ' delante', right: ' a tu derecha' },
}

function posOf(box?: { left: number; width: number }) {
  if (!box) return 'centre'
  const cx = box.left + box.width / 2
  return cx < 0.38 ? 'left' : cx > 0.62 ? 'right' : 'centre'
}

/** Freshest frames: live view first, then the last event's picture, then a new Ring snapshot. */
async function framesFor(deviceId: string | null): Promise<{ frames: Frame[]; note: string }> {
  if (deviceId) {
    const live = recentFrames(deviceId, 15_000)
    if (live.length) return { frames: live, note: 'live view' }
  }
  const last = await db.event.findFirst({ where: { framePath: { not: null }, ...(deviceId ? { deviceId } : {}) }, orderBy: { receivedAt: 'desc' } })
  if (last?.framePath) {
    const buf = readFile('frames', last.framePath)
    if (buf && Date.now() - last.receivedAt.getTime() < 10 * 60_000)
      return { frames: [{ buf, source: 'ring_snapshot', label: `picture from the last event (${last.frameSource ?? 'event'})`, capturedAt: last.receivedAt.getTime() }], note: 'last event picture' }
  }
  const acq = await acquireFrames({ deviceId, timestampMs: Date.now() - 2000, simulated: true })
  return { frames: acq.frames, note: acq.notes.join('; ') }
}

export async function askDoor(question: string, opts: { lang?: Language; deviceId?: string | null } = {}): Promise<AskResult> {
  const settings = await getSettings()
  const lang = (opts.lang ?? settings.language) as Language
  const deviceId = opts.deviceId ?? settings.selectedDeviceId
  const device = await getDevice(deviceId)
  const cam = cameraName(settings, deviceId, device?.name)
  const id = `qa-${crypto.randomUUID()}`
  const stages: StageMetric[] = []
  const emit = (m: StageMetric) => {
    stages.push(m)
    publish({ kind: 'stage', eventId: id, ...m })
  }

  let s = Date.now()
  const intent = classifyQuestion(question)
  emit({ stage: 'stage0', status: 'passed', latency_ms: Date.now() - s, note: `intent "${intent}": ${INTENT_ROUTE[intent]}` })

  let answer = ''
  let guardFired = false
  let frameSource: string | null = null

  // Identity questions never reach a model.
  const lastDescription = async (): Promise<StructuredDescription | null> => {
    const last = await db.event.findFirst({ where: { descriptionJson: { not: null }, guardFired: false }, orderBy: { receivedAt: 'desc' } })
    return last?.descriptionJson ? JSON.parse(last.descriptionJson) : null
  }

  if (device?.e2ee) {
    answer = T.e2ee[lang](cam)
  } else if (intent === 'identity') {
    const d = await lastDescription()
    const facts = d ? compose(d, { lang, cameraName: cam }) : ''
    const lead = lang === 'en' && facts ? ' I can tell you this: ' : ' '
    answer = `${T.identity[lang]}${facts ? lead + facts : ''}`.trim()
    emit({ stage: 'guardrails', status: 'passed', latency_ms: 0, note: 'identity question refused by policy; no model call' })
  } else {
    s = Date.now()
    const got = await framesFor(deviceId)
    const sel = await selectFrames(got.frames, intent === 'presence' || intent === 'vehicle_presence' ? 1 : 3)
    const frames = await Promise.all(sel.kept.map(async (f) => ({ ...f, buf: await applyPrivacyZones(f.buf, device?.privacyZones ?? []) })))
    frameSource = frames[0]?.label ?? null
    emit({ stage: 'frames', status: frames.length ? 'passed' : 'stopped', latency_ms: Date.now() - s, note: `${got.note}${frameSource ? `; best: ${frameSource}` : ''}` })
    if (!frames.length) {
      answer = T.noFrame[lang](cam)
    } else if (intent === 'presence' || intent === 'vehicle_presence') {
      // Cheap path: Stage 1 only.
      s = Date.now()
      let s1: Stage1Result | null = null
      try {
        const r = await withFallback('qa-stage1', providers().detector, (p) => p.detect(frames[0].buf))
        s1 = r.result
        emit({ stage: 'stage1', status: 'passed', latency_ms: Date.now() - s, model_used: r.provider, cost_estimate: r.result.costUsd, note: `person ${s1.person.toFixed(2)}, vehicle ${s1.vehicle.toFixed(2)}` })
      } catch (e) {
        emit({ stage: 'stage1', status: 'error', latency_ms: Date.now() - s, note: (e as Error).message.slice(0, 200) })
      }
      // Unsure cheap answer? Confirm with the fast vision model (through the guardrails)
      // rather than tell a blind user "no one is there" on a 45% guess.
      const key = intent === 'presence' ? 'person' : 'vehicle'
      if (s1 && s1[key] >= 0.25 && s1[key] < 0.7) {
        s = Date.now()
        try {
          const r3 = await runStage3([frames[0].buf], 'narrate', { eventType: 'question' })
          const g = guard(r3.raw, { cameraName: cam })
          const n = key === 'person' ? g.description?.people.length ?? 0 : g.description?.vehicles.length ?? 0
          emit({ stage: 'stage3', status: 'passed', latency_ms: Date.now() - s, model_used: `${r3.call.provider}:${r3.call.model}`, cost_estimate: r3.totalCost, note: `Stage 1 unsure (${s1[key].toFixed(2)}); vision model counted ${n} ${key}(s)` })
          if (g.ok) s1 = { ...s1, [key]: n > 0 ? 0.9 : 0, detections: n > 0 && !s1.detections.some((d) => d.category === key) ? [{ label: key, category: key, confidence: 0.9 }] : s1.detections }
        } catch (e) {
          emit({ stage: 'stage3', status: 'error', latency_ms: Date.now() - s, note: (e as Error).message.slice(0, 200) })
        }
      }
      if (!s1) answer = T.noFrame[lang](cam)
      else if (intent === 'presence') {
        const people = s1.detections.filter((d) => d.category === 'person')
        if (s1.person < 0.5) answer = T.noOne[lang]
        else {
          const n = Math.max(1, people.length)
          const who = { en: n === 1 ? 'One person is' : `${n} people are`, hi: n === 1 ? 'एक व्यक्ति' : `${n} लोग`, bn: n === 1 ? 'একজন' : `${n} জন`, es: n === 1 ? 'Una persona' : `${n} personas` }[lang]
          answer = T.stillThere[lang](who, POS[lang][posOf(people[0]?.box)])
        }
      } else {
        answer = s1.vehicle >= 0.5 ? T.vehicleStill[lang]({ en: 'a vehicle', hi: 'एक गाड़ी', bn: 'একটি গাড়ি', es: 'un vehículo' }[lang]) : T.vehicleGone[lang]
      }
    } else {
      // Stage 3 with the strong model, then the full guardrail stack.
      s = Date.now()
      const s3intent: Stage3Intent = intent === 'read' ? 'read' : intent === 'describe' ? 'describe' : 'spatial'
      let raw = ''
      try {
        const r = await runStage3(frames.map((f) => f.buf), s3intent, { question, forceStrong: true })
        raw = r.raw
        emit({ stage: 'stage3', status: 'passed', latency_ms: Date.now() - s, model_used: `${r.call.provider}:${r.call.model}`, cost_estimate: r.totalCost })
      } catch (e) {
        emit({ stage: 'stage3', status: 'error', latency_ms: Date.now() - s, note: (e as Error).message.slice(0, 200) })
      }
      s = Date.now()
      const jr = raw ? await judge(raw) : { verdict: undefined, costUsd: 0 }
      const g = guard(raw, { cameraName: cam, allowText: intent === 'read', judgment: jr.verdict })
      guardFired = g.fired
      emit({ stage: 'guardrails', status: g.fired ? 'fired' : 'passed', latency_ms: Date.now() - s, confidence: g.confidence, cost_estimate: jr.costUsd, model_used: jr.verdict?.source, note: g.layers.map((l) => `${l.layer}: ${l.status}${l.notes.length ? ` (${l.notes.join('; ')})` : ''}`).join(' | ') })
      if (!g.ok || !g.description) {
        answer = lang === 'en' ? `Sorry, I can't answer that safely. ${g.fallbackText}` : T.fallback[lang](cam)
      } else {
        const d = g.description
        if (intent === 'read') answer = d.text_seen.length ? T.textReads[lang](d.text_seen.join(', ')) : T.noText[lang]
        else if (lang === 'en' && d.answer && intent !== 'describe') answer = d.answer
        else answer = compose(d, { lang, cameraName: cam, mode: 'detail' })
      }
    }
  }

  // Final check on whatever is about to be spoken.
  const quoted = intent === 'read' ? answer.replace(/^.*?:\s*/, '').split(/,\s*/) : []
  if (!isSpeakable(answer, [cam, ...quoted])) {
    guardFired = true
    answer = lang === 'en' ? "Sorry, I can't answer that safely." : T.fallback[lang](cam)
  }
  emit({ stage: 'narration', status: 'passed', latency_ms: 0, note: `${answer.split(/\s+/).length} words` })
  s = Date.now()
  const spoken = await synthesize(id, answer, lang)
  emit({ stage: 'speech', status: spoken.audioUrl ? 'passed' : 'error', latency_ms: Date.now() - s, model_used: spoken.provider, cost_estimate: spoken.costUsd })

  await db.qaLog.create({
    data: { id, question, intent, answer, language: lang, modelUsed: stages.find((x) => x.stage === 'stage3')?.model_used, guardFired, stagesJson: JSON.stringify(stages) },
  })
  const a: Announcement = {
    id,
    source: 'qa',
    text: answer,
    language: lang,
    audioUrl: spoken.audioUrl,
    ttsProvider: spoken.provider,
    urgency: 'normal',
    category: 'answer',
    confidence: null,
    simulated: false,
    guardFired,
    cameraName: cam,
    at: new Date().toISOString(),
  }
  publish({ kind: 'announcement', announcement: a })
  return { id, question, intent, answer, audioUrl: spoken.audioUrl, ttsProvider: spoken.provider, stages, frameSource, guardFired }
}
