import { clearFrames } from './frame-cache'
import { exportDataset } from './dataset'
import { db } from './db'
import { getSettings } from './settings'
import { removeOlderThan, wipeDir } from './storage'

/** Deletes events, pictures and audio older than the retention setting (default 7 days). */
export async function applyRetention() {
  const { retentionDays } = await getSettings()
  const cutoff = Date.now() - retentionDays * 86_400_000
  const events = await db.event.deleteMany({ where: { receivedAt: { lt: new Date(cutoff) } } })
  await db.qaLog.deleteMany({ where: { createdAt: { lt: new Date(cutoff) } } })
  await db.expectation.updateMany({ where: { status: 'pending', windowEnd: { lt: new Date() } }, data: { status: 'expired' } })
  const files = removeOlderThan('frames', cutoff) + removeOlderThan('audio', cutoff)
  return { events: events.count, files }
}

/** One-tap wipe: everything the user's door produced, settings kept. */
export async function wipeAll() {
  await db.correction.deleteMany()
  await db.event.deleteMany()
  await db.qaLog.deleteMany()
  await db.expectation.deleteMany()
  for (const d of ['frames', 'audio', 'corrections', 'dataset'] as const) wipeDir(d)
  clearFrames()
}

const g = globalThis as unknown as { __doorvoiceTimers?: boolean }

/** Hourly retention and a nightly (03:00 local) dataset export. Started once per process. */
export function startMaintenance() {
  if (g.__doorvoiceTimers) return
  g.__doorvoiceTimers = true
  setInterval(() => applyRetention().catch((e) => console.error('[retention]', e)), 3600_000).unref()
  let lastExportDay = -1
  setInterval(() => {
    const now = new Date()
    if (now.getHours() === 3 && now.getDate() !== lastExportDay) {
      lastExportDay = now.getDate()
      exportDataset().then((r) => console.log('[dataset] nightly export', r)).catch((e) => console.error('[dataset]', e))
    }
  }, 10 * 60_000).unref()
  applyRetention().catch(() => {})
}
