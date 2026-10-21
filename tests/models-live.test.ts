import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadEnvFile } from './helpers'

// Opt-in: calls Bedrock (and fallbacks) on a saved sandbox snapshot. MODELS_LIVE=1 npm test
const live = process.env.MODELS_LIVE === '1'
const fixture = path.join(__dirname, '..', 'data', 'fixtures', 'sandbox_snapshot_1.jpg')

describe.skipIf(!live || !fs.existsSync(fixture))('model chain on a sandbox frame (live)', () => {
  it('detects, describes, guards and composes', async () => {
    loadEnvFile()
    const { providers, withFallback } = await import('@/lib/providers/registry')
    const { runStage3 } = await import('@/lib/pipeline/stage3')
    const { guard } = await import('@/lib/guardrails/guard')
    const { judge } = await import('@/lib/pipeline/run')
    const { compose } = await import('@/lib/narration/composer')
    const img = fs.readFileSync(fixture)

    let t = Date.now()
    const s1 = await withFallback('stage1', providers().detector, (p) => p.detect(img))
    console.log('stage1', s1.provider, Date.now() - t, 'ms', { person: s1.result.person, vehicle: s1.result.vehicle, package: s1.result.package }, s1.attempts)

    t = Date.now()
    const s3 = await runStage3([img], 'narrate', { eventType: 'motion_detected' })
    console.log('stage3', s3.call.model, Date.now() - t, 'ms', 'escalated', s3.escalated, '$', s3.totalCost.toFixed(5))
    console.log(s3.raw)

    t = Date.now()
    const j = await judge(s3.raw)
    const g = guard(s3.raw, { cameraName: 'Playground Device', stage1: s1.result, judgment: j.verdict })
    console.log('guard', Date.now() - t, 'ms', g.ok, g.layers.map((l) => `${l.layer}:${l.status}`).join(' '))
    expect(g.ok).toBe(true)
    for (const lang of ['en', 'hi', 'bn', 'es'] as const) console.log(lang, compose(g.description!, { lang, cameraName: 'Playground Device' }))
  }, 120_000)
})
