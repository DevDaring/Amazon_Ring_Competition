import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { setConfigForTests } from '@/lib/config'
import { stage0 } from '@/lib/pipeline/stage0'
import { confirmExpectation, cosine, embed, stage2 } from '@/lib/pipeline/stage2'
import { compose } from '@/lib/narration/composer'
import { classifyQuestion, cleanTranscript } from '@/lib/qa/intent'
import { buildSimulatedPayload, parseWebhook, signBody, verifySignature } from '@/lib/ring/webhook'
import { computeNonce, matchUnclaimed, maskIdentifier, nonceMatches } from '@/lib/ring/linking'
import { parseExpectationsRule, parseWindow } from '@/lib/server/expectations'
import { scoreFrame, selectFrames } from '@/lib/pipeline/frames'
import { defaultSettings } from '@/lib/server/settings'
import { isSpeakable } from '@/lib/guardrails/guard'
import type { Stage1Result, StructuredDescription } from '@/lib/pipeline/types'

beforeAll(() => setConfigForTests({ DEFAULT_LANGUAGE: 'en' }))

const settings = () => defaultSettings()
const s1 = (o: Partial<Stage1Result> = {}): Stage1Result => ({ person: 0.95, package: 0.1, vehicle: 0.1, animal: 0, detections: [], empty: false, provider: 'rekognition', ...o })

const scene = (o: Partial<StructuredDescription> = {}): StructuredDescription => ({
  people: [{ age_group: 'adult', position: 'left', distance: 'near', motion: 'still', carrying: ['flat_parcel'] }],
  objects: [],
  vehicles: [{ type: 'van', colour: 'white', position: 'right', distance: 'far', motion: 'still' }],
  animals: [],
  scene: { lighting: 'day' },
  text_seen: [],
  confidence: 0.9,
  ...o,
})

describe('Stage 0 subtype routing', () => {
  it('routes doorbell presses at high priority', () => {
    expect(stage0('button_press', null, settings())).toMatchObject({ route: 'vision', priority: 'high', category: 'doorbell' })
  })
  it('reads human and vehicle subtypes', () => {
    expect(stage0('motion_detected', 'human', settings()).category).toBe('person')
    expect(stage0('motion_detected', 'vehicle', settings()).category).toBe('vehicle')
  })
  it('processes unknown subtypes instead of dropping them', () => {
    const r = stage0('motion_detected', 'drone', settings())
    expect(r.route).toBe('vision')
    expect(r.reason).toContain('not dropped')
  })
  it('processes unknown event types too', () => {
    expect(stage0('something_new', null, settings()).route).toBe('vision')
  })
  it('sends device status without vision and account events nowhere', () => {
    expect(stage0('device_offline', null, settings()).route).toBe('status')
    expect(stage0('app_integration_added', null, settings()).route).toBe('admin')
  })
})

describe('Stage 2 preference model', () => {
  const base = (over: Partial<Parameters<typeof stage2>[0]> = {}) =>
    stage2({ stage0: stage0('motion_detected', 'human', settings()), stage1: s1(), settings: settings(), deviceId: 'd1', now: new Date(), expectations: [], priors: [], ...over })

  it('speaks a normal person event', () => {
    expect(base().speak).toBe(true)
  })
  it('honours "Mute this type"', () => {
    const st = { ...settings(), mutes: [{ deviceId: 'd1', category: 'person', at: '' }] }
    expect(base({ settings: st }).speak).toBe(false)
  })
  it('silences events similar to ones marked wrong twice', () => {
    const v = embed(s1(), new Date())
    const priors = [0, 1].map(() => ({ deviceId: 'd1', verdict: 'wrong' as const, category: 'person', vector: v }))
    const r = base({ priors })
    expect(r.speak).toBe(false)
    expect(r.similarWrong).toBe(2)
  })
  it('never silences the doorbell', () => {
    const v = embed(s1(), new Date())
    const priors = [0, 1].map(() => ({ deviceId: 'd1', verdict: 'wrong' as const, category: 'person', vector: v }))
    expect(base({ stage0: stage0('button_press', null, settings()), priors }).speak).toBe(true)
  })
  it('matches an expectation window and speaks even if the type is muted', () => {
    const now = new Date()
    const exp = { id: 'e1', text: 'grocery delivery', kind: 'delivery' as const, objectType: 'grocery_bag', windowStart: new Date(now.getTime() - 600_000), windowEnd: new Date(now.getTime() + 600_000) }
    const st = { ...settings(), announce: { ...settings().announce, person: false } }
    const r = base({ settings: st, expectations: [exp] })
    expect(r.speak).toBe(true)
    expect(r.expectationCandidates).toEqual(['e1'])
  })
  it('gives a gentle early alert in quiet hours', () => {
    const now = new Date()
    const hh = (h: number) => String((h + 24) % 24).padStart(2, '0') + ':00'
    const st = { ...settings(), quietHours: { enabled: true, start: hh(now.getHours() - 1), end: hh(now.getHours() + 2) } }
    const r = base({ settings: st })
    expect(r.urgency).toBe('gentle')
    expect(r.earlyAlert).toBe(true)
  })
  it('cosine similarity behaves', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })
  it('confirms a grocery expectation only when bags are seen', () => {
    const e = { id: 'x', text: '', kind: 'delivery' as const, objectType: 'grocery_bag', windowStart: new Date(), windowEnd: new Date() }
    expect(confirmExpectation(e, scene())).toBe(false)
    expect(confirmExpectation(e, scene({ people: [{ age_group: 'adult', position: 'left', distance: 'near', motion: 'still', carrying: ['grocery_bag'] }] }))).toBe(true)
  })
})

describe('Narration composer', () => {
  it('produces the spec example in English, spatial first', () => {
    const s = compose(scene(), { lang: 'en', cameraName: 'front door', eventType: 'button_press' })
    expect(s).toBe('Doorbell. One adult at the door holding a flat parcel, standing to your left. A white van is parked on your right, further away.')
  })
  it('keeps the first utterance within 25 words', () => {
    const d = scene({
      people: Array.from({ length: 4 }, (_, i) => ({ age_group: 'adult' as const, position: (['left', 'centre', 'right'] as const)[i % 3], distance: 'near' as const, motion: 'toward' as const, carrying: ['parcel' as const, 'grocery_bag' as const] })),
    })
    expect(compose(d, { lang: 'en', cameraName: 'front door' }).split(/\s+/).length).toBeLessThanOrEqual(25)
  })
  it('hedges between 0.5 and 0.8', () => {
    expect(compose(scene({ confidence: 0.6 }), { lang: 'en', cameraName: 'front door' })).toMatch(/^Looks like one adult/)
  })
  it('says it cannot tell below 0.5', () => {
    expect(compose(scene({ confidence: 0.3 }), { lang: 'en', cameraName: 'front door' })).toBe("Motion at the front door. I can't tell what it is yet.")
  })
  it('renders Hindi, Bengali and Spanish from the same JSON', () => {
    const hi = compose(scene(), { lang: 'hi', cameraName: 'मुख्य दरवाज़ा', eventType: 'button_press' })
    const bn = compose(scene(), { lang: 'bn', cameraName: 'সামনের দরজা' })
    const es = compose(scene(), { lang: 'es', cameraName: 'puerta' })
    expect(hi).toContain('दरवाज़े की घंटी')
    expect(hi).toContain('आपकी बाईं ओर')
    expect(bn).toContain('আপনার বাঁদিকে')
    expect(es).toBe('Una persona adulta en la puerta con un paquete plano, a tu izquierda. Una furgoneta blanca aparcada a tu derecha.')
  })
  it('summarises a car park of vehicles in one clause', () => {
    const d = scene({ people: [], vehicles: Array.from({ length: 4 }, () => ({ type: 'car' as const, colour: 'grey' as const, position: 'right' as const, distance: 'far' as const, motion: 'still' as const })) })
    expect(compose(d, { lang: 'en', cameraName: 'front door' })).toBe('Four vehicles are parked further away.')
  })
  it('announces matched expectations without naming anyone', () => {
    const s = compose(scene(), { lang: 'en', cameraName: 'front door', expectation: { kind: 'visitor', at: new Date(2026, 9, 21, 16, 52) } })
    expect(s.startsWith('This looks like your expected visitor, 4:52')).toBe(true)
    expect(isSpeakable(s)).toBe(true)
  })
  it('composer output always passes the final speakable check', () => {
    for (const lang of ['en', 'hi', 'bn', 'es'] as const) expect(isSpeakable(compose(scene(), { lang, cameraName: 'front door' }), ['front door'])).toBe(true)
  })
})

describe('Ask the Door intent classifier', () => {
  it.each([
    ['Who is it?', 'identity'],
    ['Is that my neighbour?', 'identity'],
    ['Is anyone still there?', 'presence'],
    ['Did they leave?', 'presence'],
    ['Is the van still there?', 'vehicle_presence'],
    ['What are they holding?', 'spatial'],
    ['Where is the box?', 'spatial'],
    ['Read the label', 'read'],
    ['Describe everything', 'describe'],
    ['कौन है?', 'identity'],
    ['কেউ আছে?', 'presence'],
    ['কে এসেছে?', 'identity'],
    ['¿Quién es?', 'identity'],
  ])('%s -> %s', (q, intent) => {
    expect(classifyQuestion(q)).toBe(intent)
  })
})

describe('Spoken question cleanup (screen reader picked up by the microphone)', () => {
  it('removes NVDA announcements of the push-to-talk button', () => {
    expect(cleanTranscript('Stop and send toggle button pressed. Speak after the beep. Is the car still there?')).toBe('Is the car still there?')
    expect(cleanTranscript('Listening. Who is it?')).toBe('Who is it?')
  })
  it('leaves a normal question alone', () => {
    expect(cleanTranscript('What are they holding?')).toBe('What are they holding?')
  })
  it('still classifies after cleanup', () => {
    expect(classifyQuestion(cleanTranscript('Push to talk button. Is anyone still there?'))).toBe('presence')
  })
})

describe('Ring webhook signature and parsing', () => {
  const key = 'test-hmac-key'
  it('verifies sha256=<hex> over the raw body', () => {
    const raw = JSON.stringify(buildSimulatedPayload({ type: 'button_press', deviceId: 'dev' }))
    const sig = signBody(raw, key)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(verifySignature(raw, sig, key)).toBe(true)
    expect(verifySignature(raw + ' ', sig, key)).toBe(false)
    expect(verifySignature(raw, sig, 'other-key')).toBe(false)
    expect(verifySignature(raw, null, key)).toBe(false)
  })
  it('reads subType from data.subType or attributes.sub_type', () => {
    const p1 = buildSimulatedPayload({ type: 'motion_detected', subType: 'vehicle', deviceId: 'dev' })
    expect(parseWebhook(p1)).toMatchObject({ ok: true, event: { subType: 'vehicle', deviceId: 'dev' } })
    const p2: any = buildSimulatedPayload({ type: 'motion_detected', deviceId: 'dev' })
    p2.data.attributes.sub_type = 'human'
    expect(parseWebhook(p2)).toMatchObject({ ok: true, event: { subType: 'human' } })
  })
  it('rejects payloads without a request_id', () => {
    expect(parseWebhook({ meta: {}, data: { id: 'x', type: 'button_press', attributes: {} } }).ok).toBe(false)
  })
})

describe('Account-linking nonce', () => {
  it('is HMAC-SHA256 base64url without padding over "<time>:<account_id>"', () => {
    const n = computeNonce(1771130906289, 'acct-1', 'k')
    expect(n).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(nonceMatches(n, 1771130906289, 'acct-1', 'k')).toBe(true)
    expect(nonceMatches(n, 1771130906289, 'acct-2', 'k')).toBe(false)
  })
  it('rejects nonces older than 10 minutes', () => {
    setConfigForTests({ RING_HMAC_KEY: 'k' })
    const t = Date.now() - 11 * 60_000
    expect(matchUnclaimed(computeNonce(t, 'a', 'k'), t, [{ accountId: 'a', accessToken: 'x' }])).toBeNull()
    const t2 = Date.now() - 60_000
    expect(matchUnclaimed(computeNonce(t2, 'a', 'k'), t2, [{ accountId: 'b', accessToken: 'y' }, { accountId: 'a', accessToken: 'x' }])?.accessToken).toBe('x')
  })
  it('masks the partner email', () => {
    expect(maskIdentifier('koushik@example.com')).toBe('k***k@example.com')
  })
})

describe('"I\'m expecting..." parser', () => {
  const now = new Date(2026, 9, 21, 14, 0)
  it('splits a grocery delivery and a visitor around 5', () => {
    const items = parseExpectationsRule("I'm expecting a grocery delivery and my sister around 5.", now)
    expect(items.map((i) => i.kind)).toEqual(['delivery', 'visitor'])
    expect(items[0].objectType).toBe('grocery_bag')
    expect(items[1].windowStart.getHours()).toBe(16)
    expect(items[1].windowEnd.getHours()).toBe(17)
  })
  it('stores no names: the visitor is only a time window', () => {
    const items = parseExpectationsRule('expecting my sister Priya at 6pm', now)
    expect(items[0].kind).toBe('visitor')
    expect(Object.keys(items[0])).not.toContain('name')
  })
  it('reads vehicle colour and type', () => {
    const [v] = parseExpectationsRule('a white van at 3:30pm', now)
    expect(v).toMatchObject({ kind: 'vehicle', vehicleColour: 'white', vehicleType: 'van' })
  })
  it('handles "in 10 minutes" and keeps time words out of the label', () => {
    const [car, visitor] = parseExpectationsRule('I am expecting a grey car in 10 minutes and my sister around 5', now)
    expect(car.text).toBe('a grey car')
    expect(car.windowEnd.getTime() - now.getTime()).toBe(40 * 60_000)
    expect(visitor.text).toBe('my sister')
    expect(visitor.windowStart.getHours()).toBe(16)
  })
  it('parses relative and ranged windows', () => {
    expect(parseWindow('in 2 hours', now)!.start.getHours()).toBe(15)
    const r = parseWindow('between 4 and 6', now)!
    expect([r.start.getHours(), r.end.getHours()]).toEqual([16, 18])
  })
})

describe('Frame selection', () => {
  const textured = () =>
    sharp({ create: { width: 640, height: 360, channels: 3, background: '#777' } })
      .composite([{ input: Buffer.from(`<svg width="640" height="360">${Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 37) % 600}" y="${(i * 53) % 320}" width="20" height="20" fill="${i % 2 ? '#000' : '#fff'}"/>`).join('')}</svg>`) }])
      .jpeg()
      .toBuffer()
  it('scores a textured frame sharper than its blurred copy', async () => {
    const sharpBuf = await textured()
    const blur = await sharp(sharpBuf).blur(8).jpeg().toBuffer()
    expect((await scoreFrame(sharpBuf)).sharpness).toBeGreaterThan((await scoreFrame(blur)).sharpness * 3)
  })
  it('drops black and blurry frames, keeps the sharp one', async () => {
    const sharpBuf = await textured()
    const black = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#000' } }).jpeg().toBuffer()
    const blur = await sharp(sharpBuf).blur(10).jpeg().toBuffer()
    const mk = (buf: Buffer, label: string) => ({ buf, label, source: 'ring_snapshot' as const, capturedAt: 0 })
    const r = await selectFrames([mk(black, 'black'), mk(blur, 'blur'), mk(sharpBuf, 'sharp')], 3)
    expect(r.kept.map((f) => f.label)).toEqual(['sharp'])
    expect(r.dropped.map((d) => d.frame.label).sort()).toEqual(['black', 'blur'])
  })
  it('ignores watermark text when scoring', async () => {
    const flat = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#888' } }).jpeg().toBuffer()
    const withMark = await sharp(flat)
      .composite([{ input: Buffer.from('<svg width="640" height="360"><text x="460" y="20" font-size="14" fill="white">Device-ID: ...42NAJZ</text><text x="460" y="38" font-size="14" fill="white">Generated-At: 2026</text></svg>') }])
      .jpeg()
      .toBuffer()
    const a = await scoreFrame(flat)
    const b = await scoreFrame(withMark)
    expect(Math.abs(b.sharpness - a.sharpness)).toBeLessThan(5)
  })
})
