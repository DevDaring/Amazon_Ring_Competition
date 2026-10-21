import type { Language } from '../pipeline/types'
import { eventHistory, HistoryEvent } from '../ring/client'
import { db } from './db'
import { getDevices } from './devices'
import { cameraName, getSettings } from './settings'

// Caregiver mode: a text-only "While you were out" summary. No video or pictures are
// ever shared, only counts and times. Built from Ring's event history plus DoorVoice's
// own guarded descriptions (which tell a delivery from a visitor).

export interface Digest {
  generatedAt: string
  periodHours: number
  language: Language
  text: string
  lines: string[]
  anomaly: string | null
  sources: string[]
  counts: { deliveries: number; visitors: number; doorbell: number; vehicles: number; motion: number; liveViews: number }
}

const DAY_NAMES: Record<Language, string> = { en: 'en-GB', hi: 'hi-IN', bn: 'bn-IN', es: 'es-ES' }

const fmtTime = (ms: number, lang: Language) =>
  new Date(ms).toLocaleTimeString(DAY_NAMES[lang], { hour: 'numeric', minute: '2-digit', hour12: lang !== 'es' })

const L = {
  deliveries: { en: (n: number) => `${n} ${n === 1 ? 'delivery' : 'deliveries'}`, hi: (n: number) => `${n} डिलीवरी`, bn: (n: number) => `${n}টি ডেলিভারি`, es: (n: number) => `${n} ${n === 1 ? 'entrega' : 'entregas'}` },
  visitors: { en: (n: number, at: string) => `${n} ${n === 1 ? 'visitor' : 'visitors'}${at ? ` at ${at}` : ''}`, hi: (n: number, at: string) => `${n} मेहमान${at ? ` (${at})` : ''}`, bn: (n: number, at: string) => `${n} জন অতিথি${at ? ` (${at})` : ''}`, es: (n: number, at: string) => `${n} ${n === 1 ? 'visita' : 'visitas'}${at ? ` a las ${at}` : ''}` },
  vehicles: { en: (n: number) => `${n} vehicle ${n === 1 ? 'alert' : 'alerts'}`, hi: (n: number) => `${n} गाड़ी अलर्ट`, bn: (n: number) => `${n}টি গাড়ির সতর্কতা`, es: (n: number) => `${n} avisos de vehículo` },
  quietAfter: { en: (t: string) => `no activity after ${t}`, hi: (t: string) => `${t} के बाद कोई गतिविधि नहीं`, bn: (t: string) => `${t}-এর পরে কোনো কার্যকলাপ নেই`, es: (t: string) => `sin actividad después de las ${t}` },
  none: { en: 'no door activity', hi: 'दरवाज़े पर कोई गतिविधि नहीं', bn: 'দরজায় কোনো কার্যকলাপ নেই', es: 'sin actividad en la puerta' },
  anomaly: {
    en: (h: number, cam: string) => `No ${cam} activity for ${h} hours.`,
    hi: (h: number, cam: string) => `${h} घंटे से ${cam} पर कोई गतिविधि नहीं।`,
    bn: (h: number, cam: string) => `${h} ঘণ্টা ধরে ${cam}-এ কোনো কার্যকলাপ নেই।`,
    es: (h: number, cam: string) => `Sin actividad en ${cam} desde hace ${h} horas.`,
  },
}

export async function buildDigest(opts: { hours?: number; lang?: Language } = {}): Promise<Digest> {
  const settings = await getSettings()
  const lang = opts.lang ?? (settings.language as Language)
  const hours = opts.hours ?? 24
  const since = Date.now() - hours * 3600_000
  const sources: string[] = []

  // Ring history (if connected).
  let ring: HistoryEvent[] = []
  let camName = 'front door'
  try {
    const devices = await getDevices()
    const dev = devices.find((d) => d.id === settings.selectedDeviceId) ?? devices[0]
    if (dev) {
      camName = cameraName(settings, dev.id, dev.name)
      ring = await eventHistory(dev.id, { since, maxPages: 5 })
      sources.push(`Ring event history (${ring.length} events)`)
    }
  } catch (e) {
    sources.push(`Ring history unavailable: ${(e as Error).message.slice(0, 80)}`)
  }

  // DoorVoice's own guarded descriptions.
  const local = await db.event.findMany({ where: { receivedAt: { gte: new Date(since) } }, orderBy: { receivedAt: 'asc' } })
  sources.push(`DoorVoice events (${local.length}, of which ${local.filter((e) => e.simulated).length} simulated)`)

  let deliveries = 0
  const visitorTimes: number[] = []
  let vehicles = 0
  for (const e of local) {
    if (!e.descriptionJson || e.guardFired) continue
    const d = JSON.parse(e.descriptionJson)
    const hasPackage = d.objects?.some((o: any) => /parcel|bag|envelope|food/.test(o.type)) || d.people?.some((p: any) => p.carrying?.length)
    if (hasPackage) deliveries++
    else if (d.people?.length) visitorTimes.push(e.receivedAt.getTime())
    if (d.vehicles?.length && !d.people?.length) vehicles++
  }
  // A met delivery expectation is a delivery even if its picture showed no parcel.
  deliveries = Math.max(deliveries, await db.expectation.count({ where: { status: 'met', kind: 'delivery', matchedAt: { gte: new Date(since) } } }))

  const dings = ring.filter((e) => e.type === 'ding')
  const motion = ring.filter((e) => e.type?.startsWith('motion'))
  const liveViews = ring.filter((e) => e.type === 'on_demand').length
  // A doorbell press with no matching description still counts as a visitor.
  for (const d of dings) if (!visitorTimes.some((t) => Math.abs(t - d.start) < 120_000)) visitorTimes.push(d.start)
  visitorTimes.sort((a, b) => a - b)

  const allTimes = [...local.map((e) => e.receivedAt.getTime()), ...dings.map((d) => d.start), ...motion.map((m) => m.start)].sort((a, b) => a - b)
  const lastActivity = allTimes[allTimes.length - 1]

  const day = new Date().toLocaleDateString(DAY_NAMES[lang], { weekday: 'long' })
  const parts: string[] = []
  if (deliveries) parts.push(L.deliveries[lang](deliveries))
  if (visitorTimes.length) parts.push(L.visitors[lang](visitorTimes.length, visitorTimes.slice(0, 3).map((t) => fmtTime(t, lang)).join(', ')))
  if (vehicles) parts.push(L.vehicles[lang](vehicles))
  if (!parts.length) parts.push(L.none[lang])
  else if (lastActivity && Date.now() - lastActivity > 2 * 3600_000) parts.push(L.quietAfter[lang](fmtTime(lastActivity, lang)))

  // Anomaly: nothing at all for longer than the caregiver's threshold.
  const lastEver = Math.max(
    lastActivity ?? 0,
    (await db.event.findFirst({ orderBy: { receivedAt: 'desc' } }))?.receivedAt.getTime() ?? 0
  )
  const silentHours = lastEver ? Math.floor((Date.now() - lastEver) / 3600_000) : hours
  const anomaly = silentHours >= settings.anomalyHours ? L.anomaly[lang](silentHours, camName) : null

  const stop = lang === 'hi' || lang === 'bn' ? '।' : '.'
  const text = `${day}: ${parts.join(', ')}${stop}${anomaly ? ` ${anomaly}` : ''}`
  return {
    generatedAt: new Date().toISOString(),
    periodHours: hours,
    language: lang,
    text,
    lines: parts,
    anomaly,
    sources,
    counts: { deliveries, visitors: visitorTimes.length, doorbell: dings.length, vehicles, motion: motion.length, liveViews },
  }
}
