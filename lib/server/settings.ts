import { z } from 'zod'
import { config } from '../config'
import { db } from './db'

const time = z.string().regex(/^\d{2}:\d{2}$/)

export const SettingsSchema = z.object({
  language: z.enum(['en', 'hi', 'bn', 'es']),
  /** voice = speak aloud; visual = deaf / hard-of-hearing mode (flash, captions, vibration). */
  mode: z.enum(['voice', 'visual']),
  showBoxes: z.boolean(),
  speechRate: z.number().min(0.6).max(1.6),
  announce: z.object({
    button_press: z.boolean(),
    person: z.boolean(),
    vehicle: z.boolean(),
    motion: z.boolean(),
    animal: z.boolean(),
    package: z.boolean(),
  }),
  quietHours: z.object({ enabled: z.boolean(), start: time, end: time }),
  retentionDays: z.number().int().min(1).max(90),
  anomalyHours: z.number().int().min(6).max(168),
  /** Per-camera overrides: user-facing name and whether it is indoor or outdoor. */
  cameras: z.record(z.string(), z.object({ name: z.string().max(40), kind: z.enum(['outdoor', 'indoor']) })),
  /** "Mute this type" taps: camera + category pairs that stay silent. */
  mutes: z.array(z.object({ deviceId: z.string(), category: z.string(), at: z.string() })),
  selectedDeviceId: z.string().nullable(),
})

export type Settings = z.infer<typeof SettingsSchema>

export function defaultSettings(): Settings {
  return {
    language: config().DEFAULT_LANGUAGE,
    mode: 'voice',
    showBoxes: false,
    speechRate: 1,
    announce: { button_press: true, person: true, vehicle: true, motion: true, animal: true, package: true },
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    retentionDays: 7,
    anomalyHours: 36,
    cameras: {},
    mutes: [],
    selectedDeviceId: null,
  }
}

const KEY = 'settings'

export async function getSettings(): Promise<Settings> {
  const row = await db.setting.findUnique({ where: { key: KEY } })
  if (!row) return defaultSettings()
  const merged = { ...defaultSettings(), ...JSON.parse(row.value) }
  const parsed = SettingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : defaultSettings()
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = SettingsSchema.parse({ ...(await getSettings()), ...patch })
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } })
  return next
}

export function cameraName(settings: Settings, deviceId: string | null | undefined, ringName?: string) {
  if (deviceId && settings.cameras[deviceId]?.name) return settings.cameras[deviceId].name
  return ringName || 'front door'
}

export function inQuietHours(settings: Settings, now = new Date()) {
  const q = settings.quietHours
  if (!q.enabled) return false
  const mins = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = q.start.split(':').map(Number)
  const [eh, em] = q.end.split(':').map(Number)
  const s = sh * 60 + sm
  const e = eh * 60 + em
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e
}
