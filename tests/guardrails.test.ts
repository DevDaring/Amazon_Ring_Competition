import { describe, expect, it } from 'vitest'
import { guard, isSpeakable, parseModelOutput, scanText, GuardContext } from '@/lib/guardrails/guard'

const ctx: GuardContext = { cameraName: 'front door', cameraKind: 'outdoor' }

const base = () => ({
  people: [
    { age_group: 'adult', position: 'left', distance: 'near', motion: 'toward', carrying: ['flat_parcel'], clothing_colour: 'blue' },
  ],
  objects: [],
  vehicles: [{ type: 'van', colour: 'white', position: 'right', distance: 'far', motion: 'still' }],
  animals: [],
  scene: { lighting: 'day' },
  text_seen: [],
  confidence: 0.9,
})

const withPerson = (extra: Record<string, unknown>) => {
  const d: any = base()
  Object.assign(d.people[0], extra)
  return d
}

const layer = (r: ReturnType<typeof guard>, name: string) => r.layers.find((l) => l.layer === name)!

describe('layer 1: schema validation', () => {
  it('passes a clean description untouched', () => {
    const r = guard(base(), ctx)
    expect(r.ok).toBe(true)
    expect(r.fired).toBe(false)
    expect(r.description?.people[0].carrying).toEqual(['flat_parcel'])
  })

  it('rejects free text instead of JSON', () => {
    const r = guard('A man is standing at the door looking around.', ctx)
    expect(r.fired).toBe(true)
    expect(r.firedBy).toBe('schema')
    expect(r.fallbackText).toBe('Motion detected at front door.')
  })

  it('rejects malformed JSON', () => {
    const r = guard('{"people": [', ctx)
    expect(r.firedBy).toBe('schema')
  })

  it('rejects a JSON array or missing confidence', () => {
    expect(guard('[]', ctx).firedBy).toBe('schema')
    const d: any = base()
    delete d.confidence
    expect(guard(d, ctx).firedBy).toBe('schema')
  })

  it('rejects unknown top-level fields such as an "intent" verdict', () => {
    const d: any = { ...base(), intent: 'delivery' }
    expect(guard(d, ctx).firedBy).toBe('schema')
  })

  it('coerces out-of-vocabulary enum values instead of passing them through', () => {
    const d: any = base()
    d.people[0].age_group = 'elderly'
    d.vehicles[0].colour = 'gold-ish'
    const r = guard(d, ctx)
    expect(r.ok).toBe(true)
    expect(r.description?.people[0].age_group).toBe('unknown')
    expect(r.description?.vehicles[0].colour).toBe('unknown')
  })

  it('drops unknown nested fields and records them', () => {
    const r = guard(withPerson({ ethnicity: 'asian' }), ctx)
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r.description)).not.toContain('asian')
    expect(layer(r, 'schema').notes.join()).toContain('people[0].ethnicity')
  })
})

describe('layer 2: forbidden attributes', () => {
  it('drops a race term in clothing text', () => {
    const r = guard(withPerson({ clothing: 'black man in a hoodie' }), ctx)
    expect(r.ok).toBe(true)
    expect(r.description?.people[0].clothing).toBeUndefined()
    expect(layer(r, 'forbidden').notes.join()).toContain('race_ethnicity')
  })

  it('drops an ethnicity word', () => {
    const r = guard(withPerson({ clothing: 'Hispanic person, red jacket' }), ctx)
    expect(r.description?.people[0].clothing).toBeUndefined()
  })

  it('drops a gender term', () => {
    const r = guard(withPerson({ clothing: 'woman wearing a green coat' }), ctx)
    expect(r.description?.people[0].clothing).toBeUndefined()
    expect(layer(r, 'forbidden').notes.join()).toContain('gender')
  })

  it('keeps colour words when they describe clothing, not people', () => {
    const r = guard(withPerson({ clothing: 'white t-shirt and black cap' }), ctx)
    expect(r.description?.people[0].clothing).toBe('white t-shirt and black cap')
  })

  it('drops religion and disability descriptors', () => {
    expect(guard(withPerson({ clothing: 'wearing a hijab' }), ctx).description?.people[0].clothing).toBeUndefined()
    expect(guard(withPerson({ clothing: 'in a wheelchair' }), ctx).description?.people[0].clothing).toBeUndefined()
  })

  it('drops body descriptors, including height next to a person noun', () => {
    expect(guard(withPerson({ clothing: 'overweight, grey jumper' }), ctx).description?.people[0].clothing).toBeUndefined()
    expect(guard(withPerson({ clothing: 'tall person in a coat' }), ctx).description?.people[0].clothing).toBeUndefined()
    expect(guard(withPerson({ clothing: 'short sleeves' }), ctx).description?.people[0].clothing).toBe('short sleeves')
  })

  it('drops age beyond child/adult', () => {
    expect(guard(withPerson({ clothing: 'elderly, beige coat' }), ctx).description?.people[0].clothing).toBeUndefined()
  })

  it('falls back when the model writes "suspicious"', () => {
    const d: any = base()
    d.scene.summary = 'A suspicious person is looking at the parcel'
    const r = guard(d, ctx)
    expect(r.fired).toBe(true)
    expect(r.firedBy).toBe('forbidden')
    expect(r.suppressed).toContain('suspicious')
  })

  it('falls back on other intent words: lurking, casing, loitering', () => {
    for (const w of ['someone lurking by the gate', 'casing the house', 'loitering near the car']) {
      const d: any = base()
      d.scene.summary = w
      expect(guard(d, ctx).firedBy).toBe('forbidden')
    }
  })

  it('falls back when judgment hides in an unknown field', () => {
    const r = guard(withPerson({ demeanour: 'threatening' }), ctx)
    expect(r.firedBy).toBe('forbidden')
  })

  it('falls back on a person name', () => {
    const d: any = base()
    d.answer = 'That is John Smith from next door.'
    expect(guard(d, ctx).firedBy).toBe('forbidden')
  })

  it('falls back on identity claims such as "your neighbour"', () => {
    const d: any = base()
    d.answer = 'It looks like your neighbour.'
    expect(guard(d, ctx).firedBy).toBe('forbidden')
  })

  it('rewrites gendered job words instead of dropping them', () => {
    const d: any = base()
    d.objects = [{ type: 'parcel', label: 'box from the mailman', position: 'centre', distance: 'near' }]
    const r = guard(d, ctx)
    expect(r.description?.objects[0].label).toBe('box from the mail carrier')
  })

  it('never reads licence plates, even in a summary', () => {
    const d: any = base()
    d.scene.summary = 'white van, plate number KA05MN4521'
    const r = guard(d, ctx)
    expect(r.description?.scene.summary).toBeUndefined()
  })

  it('allows carrier brand names on vans', () => {
    const d: any = base()
    d.scene.summary = 'An Amazon Prime van is parked at the curb'
    expect(guard(d, ctx).description?.scene.summary).toBe('An Amazon Prime van is parked at the curb')
  })
})

describe('OCR text_seen rules', () => {
  const textCtx = { ...ctx, allowText: true }
  it('drops all text unless the user asked to read', () => {
    const d: any = { ...base(), text_seen: ['FRAGILE'] }
    expect(guard(d, ctx).description?.text_seen).toEqual([])
  })
  it('reads a harmless label when asked', () => {
    const d: any = { ...base(), text_seen: ['FRAGILE', 'THIS SIDE UP'] }
    expect(guard(d, textCtx).description?.text_seen).toEqual(['FRAGILE', 'THIS SIDE UP'])
  })
  it('reads repeated text once', () => {
    const d: any = { ...base(), text_seen: ['SENIOR', 'SENIOR', ' SENIOR'] }
    expect(guard(d, textCtx).description?.text_seen).toEqual(['SENIOR'])
  })
  it('withholds a name, an address and an ID number on a label', () => {
    const d: any = { ...base(), text_seen: ['Priya Sharma', '42 Park Street', 'Order 88213490', 'KEEP DRY'] }
    expect(guard(d, textCtx).description?.text_seen).toEqual(['KEEP DRY'])
  })
})

describe('layer 3: judgment check', () => {
  it('falls back when Bedrock Guardrails or the classifier flags the output', () => {
    const r = guard(base(), { ...ctx, judgment: { flagged: true, source: 'nova-micro-classifier', reason: 'judgmental tone' } })
    expect(r.firedBy).toBe('judgment')
    expect(r.fallbackText).toBe('Motion detected at front door.')
  })
  it('records a clean verdict', () => {
    const r = guard(base(), { ...ctx, judgment: { flagged: false, source: 'bedrock-guardrails' } })
    expect(layer(r, 'judgment').status).toBe('pass')
  })
})

describe('layer 4: plausibility', () => {
  it('falls back on a vehicle reported by an indoor camera', () => {
    const r = guard(base(), { cameraName: 'hallway', cameraKind: 'indoor' })
    expect(r.firedBy).toBe('plausibility')
    expect(r.fallbackText).toBe('Motion detected at hallway.')
  })
  it('lowers confidence for an implausible crowd', () => {
    const d: any = base()
    d.people = Array.from({ length: 10 }, () => ({ ...d.people[0] }))
    const r = guard(d, ctx)
    expect(r.ok).toBe(true)
    expect(r.confidence).toBeLessThanOrEqual(0.45)
  })
  it('lowers confidence when Stage 1 saw no person', () => {
    const r = guard(base(), { ...ctx, stage1: { person: 0, vehicle: 0.9, animal: 0, package: 0, provider: 'rekognition' } })
    expect(r.confidence).toBeLessThanOrEqual(0.6)
  })
  it('flags a single-occurrence anomaly against 7-day history', () => {
    const d: any = base()
    d.animals = [{ type: 'other', position: 'left' }]
    const r = guard(d, { ...ctx, history: { person: 20, vehicle: 10, animal: 0 } })
    expect(r.confidence).toBeLessThanOrEqual(0.7)
    expect(layer(r, 'plausibility').notes.join()).toContain('first animal')
  })
  it('falls back on an absurd entity count', () => {
    const d: any = base()
    d.objects = Array.from({ length: 12 }, () => ({ type: 'parcel', position: 'left', distance: 'near' }))
    d.people = Array.from({ length: 12 }, () => ({ ...d.people[0] }))
    // 12 + 12 + 1 vehicle > 20 entities
    expect(guard(d, ctx).firedBy).toBe('plausibility')
  })
})

describe('helpers', () => {
  it('parseModelOutput accepts a valid string', () => {
    expect(parseModelOutput(JSON.stringify(base())).ok).toBe(true)
  })
  it('scanText finds nothing in a neutral sentence', () => {
    expect(scanText('One adult at the door holding a flat parcel, standing to your left.')).toEqual([])
  })
  it('isSpeakable ignores the user-chosen camera name but still catches judgments', () => {
    expect(isSpeakable('Motion detected at Playground Device.', ['Playground Device'])).toBe(true)
    expect(isSpeakable('A suspicious adult at Playground Device.', ['Playground Device'])).toBe(false)
  })
})
