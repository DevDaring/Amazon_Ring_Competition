import { db } from './db'
import type { CorrectionPrior } from '../pipeline/stage2'

/**
 * What this camera has really seen in the last 7 days: announced events the user
 * did not mark wrong. Feeds the plausibility layer of the guardrails.
 */
export async function confirmedHistory(deviceId: string | null) {
  const since = new Date(Date.now() - 7 * 86_400_000)
  const rows = await db.event.findMany({
    where: { deviceId: deviceId ?? undefined, receivedAt: { gte: since }, status: 'announced', guardFired: false, NOT: { feedback: 'wrong' } },
    select: { descriptionJson: true },
    take: 500,
  })
  const counts = { person: 0, package: 0, vehicle: 0, animal: 0 }
  for (const r of rows) {
    if (!r.descriptionJson) continue
    try {
      const d = JSON.parse(r.descriptionJson)
      if (d.people?.length) counts.person++
      if (d.objects?.some((o: any) => /parcel|bag|envelope|food/.test(o.type))) counts.package++
      if (d.vehicles?.length) counts.vehicle++
      if (d.animals?.length) counts.animal++
    } catch {
      /* skip malformed rows */
    }
  }
  return counts
}

/** User corrections become Stage 2 priors immediately (no retraining step needed). */
export async function correctionPriors(): Promise<CorrectionPrior[]> {
  const rows = await db.correction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { event: { select: { deviceId: true, stage2Json: true } } },
  })
  return rows
    .map((r) => {
      let vector: number[] = []
      try {
        vector = JSON.parse(r.event.stage2Json ?? '{}').vector ?? []
      } catch {
        vector = []
      }
      return { deviceId: r.event.deviceId, verdict: r.verdict as CorrectionPrior['verdict'], category: r.objectType ?? 'none', vector }
    })
    .filter((p) => p.vector.length)
}
