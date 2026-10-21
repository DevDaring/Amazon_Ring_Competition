// Server-sent events to every open DoorVoice tab. Kept on globalThis because Next.js
// dev mode can load route modules more than once.

export type BusMessage =
  | { kind: 'event'; event: unknown }
  | { kind: 'stage'; eventId: string; stage: string; status: string; latency_ms: number; model_used?: string; confidence?: number; cost_estimate?: number; note?: string }
  | { kind: 'announcement'; announcement: Announcement }
  | { kind: 'qa'; qa: unknown }
  | { kind: 'metrics' }
  | { kind: 'ring'; status: unknown }

export interface Announcement {
  id: string // event or QA id
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

type Client = { send: (data: string) => void }
const g = globalThis as unknown as { __doorvoiceBus?: { clients: Set<Client>; recent: Announcement[] } }
const state = (g.__doorvoiceBus ??= { clients: new Set(), recent: [] })

export function publish(msg: BusMessage) {
  if (msg.kind === 'announcement') {
    state.recent.unshift(msg.announcement)
    state.recent.length = Math.min(state.recent.length, 20)
  }
  const data = `data: ${JSON.stringify(msg)}\n\n`
  for (const c of Array.from(state.clients)) {
    try {
      c.send(data)
    } catch {
      state.clients.delete(c)
    }
  }
}

export function subscribe(c: Client) {
  state.clients.add(c)
  return () => state.clients.delete(c)
}

export function recentAnnouncements() {
  return state.recent
}
