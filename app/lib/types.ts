// Shapes shared by client components (mirrors the API responses).

export type Language = 'en' | 'hi' | 'bn' | 'es'

export interface Announcement {
  id: string
  source: 'event' | 'qa' | 'early'
  text: string
  language: string
  audioUrl: string | null
  ttsProvider: string | null
  urgency: string
  category: string
  confidence: number | null
  simulated: boolean
  guardFired: boolean
  cameraName: string
  at: string
}

export interface StageMsg {
  eventId: string
  stage: string
  status: string
  latency_ms: number
  model_used?: string
  confidence?: number
  cost_estimate?: number
  note?: string
}

export interface Settings {
  language: Language
  mode: 'voice' | 'visual'
  showBoxes: boolean
  speechRate: number
  announce: Record<'button_press' | 'person' | 'vehicle' | 'motion' | 'animal' | 'package', boolean>
  quietHours: { enabled: boolean; start: string; end: string }
  retentionDays: number
  anomalyHours: number
  cameras: Record<string, { name: string; kind: 'outdoor' | 'indoor' }>
  mutes: Array<{ deviceId: string; category: string; at: string }>
  selectedDeviceId: string | null
}

export interface Device {
  id: string
  name: string
  displayName: string
  online: boolean
  power: 'battery' | 'line'
  e2ee: boolean
  privacyZones: unknown[]
  supportsSnapshot: boolean
  kind: 'outdoor' | 'indoor'
  imageUrl?: string
}

export const LANG_LABEL: Record<Language, string> = { en: 'English', hi: 'हिन्दी', bn: 'বাংলা', es: 'Español' }
export const LANG_BCP47: Record<Language, string> = { en: 'en-GB', hi: 'hi-IN', bn: 'bn-IN', es: 'es-ES' }
