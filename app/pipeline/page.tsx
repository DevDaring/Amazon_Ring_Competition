'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useApp } from '../providers'
import type { StageMsg } from '../lib/types'
import { Badge, Card, PageTitle, cn } from '../components/ui'

const STAGES = [
  { id: 'stage0', name: 'Stage 0', sub: 'Subtype gate', tier: 'free' },
  { id: 'frames', name: 'Frames', sub: 'Blur / dark filter', tier: 'CPU' },
  { id: 'stage1', name: 'Stage 1', sub: 'Object gate', tier: 'cheap' },
  { id: 'stage2', name: 'Stage 2', sub: 'Preferences', tier: 'cheap' },
  { id: 'stage3', name: 'Stage 3', sub: 'Vision LLM', tier: '$$$' },
  { id: 'guardrails', name: 'Guardrails', sub: 'Safety layer', tier: 'required' },
  { id: 'speech', name: 'Speech', sub: 'TTS + captions', tier: 'output' },
]

const STATUS: Record<string, { label: string; ring: string; icon: string }> = {
  passed: { label: 'passed', ring: 'border-ok', icon: '✓' },
  fired: { label: 'fallback', ring: 'border-bad', icon: '!' },
  stopped: { label: 'stopped here', ring: 'border-muted', icon: '■' },
  error: { label: 'error', ring: 'border-warn', icon: '×' },
  skipped: { label: 'skipped', ring: 'border-line', icon: '–' },
}

const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)

export default function PipelinePage() {
  const { stages, stageOrder, metricsTick } = useApp()
  const [m, setM] = useState<any>(null)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/metrics').then((r) => r.json()).then(setM)
  }, [metricsTick])

  const runId = selected ?? stageOrder.find((id) => !id.startsWith('qa-')) ?? stageOrder[0] ?? null
  const run = runId ? stages[runId] ?? [] : []

  return (
    <div className="space-y-6">
      <PageTitle sub="Ring's computer-vision guide, as running code: filter cheaply first, call the expensive model only when it earns its cost, and check every sentence before it is spoken.">Pipeline</PageTitle>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Live run</h2>
          {stageOrder.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="font-semibold">Run</span>
              <select className="min-h-[44px] rounded-xl border-2 border-line bg-surface px-3" value={runId ?? ''} onChange={(e) => setSelected(e.target.value)}>
                {stageOrder.map((id) => (
                  <option key={id} value={id}>
                    {id.startsWith('qa-') ? 'Question' : id.startsWith('guardtest') ? 'Guard test' : 'Event'} {id.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {run.length ? <RunTrack run={run} /> : <p className="mt-3 text-lg text-muted">Waiting for the next event. Use the Demo panel to send a simulated webhook.</p>}
      </Card>

      {m && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Events in (7 days)" value={m.events_in} note={m.simulated ? `${m.simulated} simulated` : undefined} />
          <Stat label="Spoken" value={m.spoken} note={`${m.silent} filtered silently`} />
          <Stat label="Safety fallbacks" value={m.guard_fired} />
          <Stat label="Avg end-to-end" value={m.avg_total_ms ? `${(m.avg_total_ms / 1000).toFixed(1)} s` : '–'} />
        </div>
      )}

      {m && <Funnel m={m} />}
      {m && <Cost m={m} />}

      {m && Object.keys(m.models).length > 0 && (
        <Card>
          <h2 className="text-2xl font-bold">Which model answered</h2>
          <table className="mt-3 w-full text-left text-lg">
            <caption className="sr-only">Model usage by stage over 7 days</caption>
            <thead>
              <tr className="border-b-2 border-line text-muted">
                <th scope="col" className="py-2 font-semibold">Stage and model</th>
                <th scope="col" className="py-2 text-right font-semibold">Events</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(m.models as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <tr key={k} className="border-b border-line">
                  <td className="break-all py-2">{k}</td>
                  <td className="py-2 text-right tabular-nums">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <Card>
      <p className="text-base text-muted">{label}</p>
      <p className="text-4xl font-bold tabular-nums">{value}</p>
      {note && <p className="text-base text-muted">{note}</p>}
    </Card>
  )
}

/** One event moving through the stages. The ordered list is the accessible version; the dot is decoration. */
function RunTrack({ run }: { run: StageMsg[] }) {
  const reduce = useReducedMotion()
  const byStage = Object.fromEntries(run.map((s) => [s.stage, s]))
  const reached = STAGES.reduce((acc, s, i) => (byStage[s.id] ? i : acc), 0)
  const total = run.reduce((a, s) => a + (s.latency_ms ?? 0), 0)
  const cost = run.reduce((a, s) => a + (s.cost_estimate ?? 0), 0)
  return (
    <div className="mt-4">
      <div className="relative hidden h-3 sm:block" aria-hidden="true">
        <div className="absolute inset-x-[7%] top-1 h-1 rounded bg-line" />
        <motion.div
          className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-accent"
          initial={false}
          animate={{ left: `${7 + (reached / (STAGES.length - 1)) * 86}%` }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18 }}
        />
      </div>
      <ol className="mt-3 grid gap-3 sm:grid-cols-7">
        {STAGES.map((s) => {
          const st = byStage[s.id]
          const status = st ? STATUS[st.status] ?? STATUS.passed : null
          return (
            <li key={s.id} className={cn('rounded-xl border-2 bg-raised p-3', status ? status.ring : 'border-dashed border-line opacity-90')}>
              <p className="font-bold">{s.name}</p>
              <p className="text-sm text-muted">
                {s.sub} · {s.tier}
              </p>
              {st ? (
                <>
                  <p className="mt-1 font-semibold">
                    <span aria-hidden="true">{status!.icon} </span>
                    {status!.label}
                  </p>
                  <p className="text-sm tabular-nums">{st.latency_ms} ms</p>
                  {st.model_used && <p className="break-words text-sm text-muted">{st.model_used}</p>}
                  {typeof st.confidence === 'number' && <p className="text-sm">conf {Math.round(st.confidence * 100)}%</p>}
                  {!!st.cost_estimate && <p className="text-sm tabular-nums">{usd(st.cost_estimate)}</p>}
                </>
              ) : (
                <p className="mt-1 text-sm text-muted">not reached</p>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-lg">
        Total {(total / 1000).toFixed(1)} s across stages · {usd(cost)} for this event
      </p>
      {run.find((s) => s.stage === 'guardrails')?.note && (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold">Guardrail layers for this run</summary>
          <p className="mt-1 break-words text-base text-muted">{run.find((s) => s.stage === 'guardrails')!.note}</p>
        </details>
      )}
    </div>
  )
}

/** Single-series funnel: one hue, direct labels, a table for screen readers. */
function Funnel({ m }: { m: any }) {
  const max = Math.max(1, m.events_in)
  const rows = useMemo(() => m.stages.map((s: any) => ({ ...s, meta: STAGES.find((x) => x.id === s.stage) })), [m])
  return (
    <Card>
      <h2 className="text-2xl font-bold">Funnel: how many events reached each stage</h2>
      <p className="text-base text-muted">Each bar is the number of events that entered the stage in the last 7 days. Fewer events reaching Stage 3 means less money spent.</p>
      <div className="mt-4 space-y-2" aria-hidden="true">
        {rows.map((r: any) => (
          <div key={r.stage} className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-3" title={`${r.meta?.name}: ${r.reached} reached, ${r.passed} passed, avg ${r.avg_latency_ms ?? '–'} ms`}>
            <span className="font-semibold">{r.meta?.name}</span>
            <div className="h-7 rounded-r bg-raised">
              <div className="h-7 rounded-r-[4px] bg-accent transition-[width]" style={{ width: `${(r.reached / max) * 100}%` }} />
            </div>
            <span className="text-right tabular-nums">{r.reached}</span>
          </div>
        ))}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer font-semibold">Funnel as a table</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Events per pipeline stage, last 7 days</caption>
          <thead>
            <tr className="border-b-2 border-line">
              <th scope="col">Stage</th>
              <th scope="col" className="text-right">Reached</th>
              <th scope="col" className="text-right">Passed</th>
              <th scope="col" className="text-right">Avg latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.stage} className="border-b border-line">
                <th scope="row" className="font-normal">{r.meta?.name} ({r.meta?.sub})</th>
                <td className="text-right tabular-nums">{r.reached}</td>
                <td className="text-right tabular-nums">{r.passed}</td>
                <td className="text-right tabular-nums">{r.avg_latency_ms ?? '–'} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  )
}

/** Measured cost vs. the naive design (every event's frames to the strong model). */
function Cost({ m }: { m: any }) {
  const a = m.cost_per_1000_actual as number
  const n = m.cost_per_1000_naive as number
  const max = Math.max(a, n, 0.0001)
  const saving = n > 0 && m.events_in ? Math.round((1 - a / n) * 100) : null
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold">Cost per 1,000 events</h2>
        {saving !== null && <Badge tone={saving > 0 ? 'ok' : 'warn'}>{saving > 0 ? `${saving}% cheaper than naive` : 'not cheaper yet'}</Badge>}
      </div>
      <dl className="mt-4 space-y-3">
        {[
          { k: 'DoorVoice (measured)', v: a, cls: 'bg-accent' },
          { k: 'Naive: every event to the strong model', v: n, cls: 'bg-muted' },
        ].map((row) => (
          <div key={row.k} className="grid grid-cols-1 gap-1 sm:grid-cols-[18rem_1fr_6rem] sm:items-center sm:gap-3">
            <dt className="font-semibold">{row.k}</dt>
            <div className="h-7 rounded-r bg-raised" aria-hidden="true">
              <div className={cn('h-7 rounded-r-[4px]', row.cls)} style={{ width: `${Math.max(1, (row.v / max) * 100)}%` }} />
            </div>
            <dd className="tabular-nums sm:text-right">{usd(row.v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-base text-muted">
        Measured over {m.events_in} event(s): {usd(m.cost_actual_usd)} actual vs {usd(m.cost_naive_usd)} naive. Naive assumes 3 frames per event to Claude Sonnet 4.5 on Bedrock ({usd(n / 1000)} per event).
      </p>
    </Card>
  )
}
