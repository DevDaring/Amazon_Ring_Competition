import { db } from '../server/db'
import type { StageMetric } from '../pipeline/types'

// What the "naive" design would pay: every event's 3 frames to the strong model.
// Claude Sonnet 4.5 on Bedrock: ~1,300 input tokens per 1280px frame + ~900 prompt
// tokens, ~300 output tokens, at $3 / $15 per million tokens = about $0.0189.
export const NAIVE_COST_PER_EVENT = (3 * 1300 + 900) * 3e-6 + 300 * 15e-6

const ORDER = ['stage0', 'frames', 'stage1', 'stage2', 'stage3', 'guardrails', 'speech'] as const

export async function funnel(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000)
  const events = await db.event.findMany({ where: { receivedAt: { gte: since } }, select: { stagesJson: true, costUsd: true, guardFired: true, totalMs: true, status: true, simulated: true, modelUsed: true } })
  const reached: Record<string, number> = Object.fromEntries(ORDER.map((s) => [s, 0]))
  const passed: Record<string, number> = Object.fromEntries(ORDER.map((s) => [s, 0]))
  const latency: Record<string, number[]> = Object.fromEntries(ORDER.map((s) => [s, []]))
  const models: Record<string, number> = {}
  for (const e of events) {
    const stages: StageMetric[] = JSON.parse(e.stagesJson || '[]')
    for (const st of stages) {
      if (!(st.stage in reached)) continue
      reached[st.stage]++
      if (st.status === 'passed' || st.status === 'fired') passed[st.stage]++
      latency[st.stage].push(st.latency_ms)
      if (st.model_used && (st.stage === 'stage1' || st.stage === 'stage3')) models[`${st.stage}: ${st.model_used}`] = (models[`${st.stage}: ${st.model_used}`] ?? 0) + 1
    }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const actual = events.reduce((a, e) => a + (e.costUsd ?? 0), 0)
  const naive = events.length * NAIVE_COST_PER_EVENT
  return {
    days,
    events_in: events.length,
    simulated: events.filter((e) => e.simulated).length,
    stages: ORDER.map((s) => ({ stage: s, reached: reached[s], passed: passed[s], avg_latency_ms: avg(latency[s]) })),
    guard_fired: events.filter((e) => e.guardFired).length,
    spoken: events.filter((e) => e.status === 'announced').length,
    silent: events.filter((e) => e.status === 'silent').length,
    avg_total_ms: avg(events.map((e) => e.totalMs ?? 0).filter(Boolean)),
    models,
    cost_actual_usd: actual,
    cost_naive_usd: naive,
    cost_per_1000_actual: events.length ? (actual / events.length) * 1000 : 0,
    cost_per_1000_naive: NAIVE_COST_PER_EVENT * 1000,
  }
}
