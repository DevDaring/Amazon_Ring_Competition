import type { Settings } from '../server/settings'

// Stage 0 is free: it reads only the webhook type and subtype and the user's
// "announce what" choices. Unknown subtypes are processed, never dropped.

export type Route = 'vision' | 'status' | 'admin'

export interface Stage0Result {
  route: Route
  announce: boolean
  priority: 'high' | 'normal' | 'low'
  category: 'doorbell' | 'person' | 'vehicle' | 'motion' | 'device' | 'sensor' | 'account'
  reason: string
}

const STATUS_EVENTS = new Set(['device_online', 'device_offline', 'device_added', 'device_removed'])
const ACCOUNT_EVENTS = new Set([
  'app_integration_added', 'app_integration_removed', 'subscription_activated', 'subscription_deactivated',
])

export function stage0(type: string, subType: string | null, settings: Pick<Settings, 'announce'>): Stage0Result {
  const a = settings.announce
  if (type === 'button_press') {
    return { route: 'vision', announce: a.button_press, priority: 'high', category: 'doorbell', reason: 'doorbell pressed' }
  }
  if (type === 'motion_detected' || type === 'person_detected') {
    const st = (subType ?? (type === 'person_detected' ? 'human' : 'unknown')).toLowerCase()
    if (st === 'human') return { route: 'vision', announce: a.person, priority: 'normal', category: 'person', reason: 'motion: human' }
    if (st === 'vehicle') return { route: 'vision', announce: a.vehicle, priority: 'low', category: 'vehicle', reason: 'motion: vehicle' }
    return {
      route: 'vision',
      announce: a.motion,
      priority: 'low',
      category: 'motion',
      reason: st === 'motion' || st === 'other_motion' ? `motion: ${st}` : `unknown subtype "${st}": processed, not dropped`,
    }
  }
  if (STATUS_EVENTS.has(type)) return { route: 'status', announce: true, priority: 'low', category: 'device', reason: type }
  if (ACCOUNT_EVENTS.has(type)) return { route: 'admin', announce: false, priority: 'low', category: 'account', reason: type }
  if (/sensor|flood|freeze|tamper|temperature|humidity|pm25|co_/.test(type))
    return { route: 'status', announce: true, priority: 'normal', category: 'sensor', reason: type }
  // Anything else Ring adds later still goes through the full pipeline.
  return { route: 'vision', announce: a.motion, priority: 'low', category: 'motion', reason: `unknown type "${type}": processed` }
}
