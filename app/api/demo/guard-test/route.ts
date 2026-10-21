import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { guard, isSpeakable } from '@/lib/guardrails/guard'
import { compose } from '@/lib/narration/composer'
import { judge } from '@/lib/pipeline/run'
import { synthesize } from '@/lib/pipeline/speech'
import { publish } from '@/lib/server/bus'
import { getSettings } from '@/lib/server/settings'
import { T } from '@/lib/narration/i18n'
import type { Language } from '@/lib/pipeline/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Canned model outputs that a vision model could plausibly produce. Each is fed
// through the real guardrail stack (including the live judgment check) so the demo
// can show a judgmental output being caught. Labelled "Simulated model output".
const SAMPLES: Record<string, unknown> = {
  suspicious: {
    people: [{ age_group: 'adult', position: 'left', distance: 'near', motion: 'still', carrying: [] }],
    objects: [], vehicles: [], animals: [],
    scene: { lighting: 'night', summary: 'A suspicious man is lurking by the door, possibly casing the house' },
    text_seen: [], confidence: 0.82,
  },
  race_gender: {
    people: [{ age_group: 'adult', position: 'centre', distance: 'near', motion: 'toward', carrying: ['parcel'], clothing: 'Black woman in a red coat' }],
    objects: [], vehicles: [], animals: [], scene: { lighting: 'day' }, text_seen: [], confidence: 0.9,
  },
  name: {
    people: [{ age_group: 'adult', position: 'right', distance: 'near', motion: 'still', carrying: [] }],
    objects: [], vehicles: [], animals: [], scene: { lighting: 'day' }, text_seen: [],
    answer: 'That is John Smith, your neighbour.', confidence: 0.88,
  },
  free_text: 'Someone is standing at the door. They look nervous.',
  plate: {
    people: [], objects: [], animals: [],
    vehicles: [{ type: 'van', colour: 'white', position: 'right', distance: 'far', motion: 'still' }],
    scene: { lighting: 'day', summary: 'white van with plate KA05MN4521 at the curb' }, text_seen: [], confidence: 0.9,
  },
}

export async function GET() {
  return NextResponse.json({ samples: Object.keys(SAMPLES) })
}

export async function POST(req: NextRequest) {
  if (!config().DEMO_MODE) return NextResponse.json({ error: 'DEMO_MODE is off' }, { status: 404 })
  const { sample } = await req.json().catch(() => ({}))
  const raw = SAMPLES[sample as string]
  if (!raw) return NextResponse.json({ error: `sample must be one of ${Object.keys(SAMPLES).join(', ')}` }, { status: 400 })
  const settings = await getSettings()
  const lang = settings.language as Language
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const jr = await judge(text)
  const result = guard(raw, { cameraName: 'front door', judgment: jr.verdict })
  // Neutralised outputs are composed and spoken like any event; fired ones speak the fallback.
  const composed = result.ok && result.description ? compose(result.description, { lang, cameraName: 'front door' }) : null
  const spokenText =
    composed && isSpeakable(composed, ['front door']) ? composed : lang === 'en' ? result.fallbackText ?? 'Motion detected at front door.' : T.fallback[lang]('front door')
  const id = `guardtest-${Date.now()}`
  {
    const spoken = await synthesize(id, spokenText, lang)
    publish({
      kind: 'announcement',
      announcement: {
        id, source: 'event', text: spokenText, language: lang, audioUrl: spoken.audioUrl, ttsProvider: spoken.provider,
        urgency: 'normal', category: 'guard-test', confidence: result.confidence, simulated: true, guardFired: result.fired, cameraName: 'front door', at: new Date().toISOString(),
      },
    })
  }
  return NextResponse.json({ simulated: true, sample, input: raw, judgment: jr.verdict ?? null, result, spoken: spokenText })
}
