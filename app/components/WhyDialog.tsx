'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { useApp } from '../providers'
import { Badge, Button } from './ui'

const STAGE_LABEL: Record<string, string> = {
  stage0: 'Stage 0 · subtype gate',
  frames: 'Frame selection',
  stage1: 'Stage 1 · object gate',
  stage2: 'Stage 2 · preferences',
  stage3: 'Stage 3 · vision model',
  guardrails: 'Guardrails',
  narration: 'Narration',
  speech: 'Speech',
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { passed: 'ok', stopped: 'neutral', skipped: 'neutral', fired: 'bad', error: 'warn' }

/** "Why did it say that?" — which stages ran, what was filtered, and how sure it was. */
export function WhyDialog() {
  const { whyId, openWhy } = useApp()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!whyId) return
    setData(null)
    setError(null)
    if (whyId.startsWith('guardtest-')) {
      setError('This was a simulated model output from the Demo panel; its full guardrail report is shown there.')
      return
    }
    fetch(`/api/events/${encodeURIComponent(whyId)}`)
      .then(async (r) => (r.ok ? setData(await r.json()) : setError('Details are not available (the event may have been deleted).')))
      .catch((e) => setError(String(e)))
  }, [whyId])

  const layers: Array<{ layer: string; status: string; notes: string[] }> = data?.guard?.layers ?? []
  const stages: any[] = data?.stages ?? []
  return (
    <Dialog.Root open={Boolean(whyId)} onOpenChange={(o) => !o && openWhy(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed inset-x-2 top-4 bottom-4 z-50 mx-auto max-w-3xl overflow-y-auto rounded-xl2 border-2 border-line bg-surface p-6 sm:inset-x-6">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="text-2xl font-bold">Why did it say that?</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="Close details">
                Close
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-muted">Every stage this {data?.kind === 'qa' ? 'answer' : 'announcement'} went through, what the safety layer changed, and how confident it was.</Dialog.Description>

          {error && <p className="mt-6 text-lg">{error}</p>}
          {!data && !error && <p className="mt-6 text-lg" role="status">Loading…</p>}

          {data && (
            <div className="mt-6 space-y-6">
              <section aria-labelledby="why-said">
                <h3 id="why-said" className="text-lg font-bold">What was said</h3>
                <p className="mt-1 text-xl">{data.narration ?? data.answer ?? '(nothing was spoken)'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {data.simulated && <Badge tone="warn">Simulated webhook</Badge>}
                  {data.question && <Badge tone="accent">Question: {data.question}</Badge>}
                  {typeof data.confidence === 'number' && <Badge tone={data.confidence >= 0.8 ? 'ok' : data.confidence >= 0.5 ? 'warn' : 'bad'}>Confidence {(data.confidence * 100).toFixed(0)}%</Badge>}
                  {data.guardFired && <Badge tone="bad">Safety fallback used</Badge>}
                  {typeof data.totalMs === 'number' && <Badge>{(data.totalMs / 1000).toFixed(1)} s end to end</Badge>}
                  {typeof data.costUsd === 'number' && <Badge>${data.costUsd.toFixed(4)}</Badge>}
                </div>
                {data.frameSource && <p className="mt-2 text-base text-muted">Picture: {data.frameSource}</p>}
              </section>

              {data.hasFrame && (
                <section aria-labelledby="why-frame">
                  <h3 id="why-frame" className="text-lg font-bold">Frame used</h3>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/events/${data.id}/frame`} alt={`Camera frame. DoorVoice described it as: ${data.narration ?? 'not described'}`} className="mt-2 w-full rounded-xl border-2 border-line" />
                </section>
              )}

              <section aria-labelledby="why-stages">
                <h3 id="why-stages" className="text-lg font-bold">Stages</h3>
                <ol className="mt-2 space-y-2">
                  {stages.map((s, i) => (
                    <li key={i} className="rounded-xl border-2 border-line p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                        <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                        <span className="text-base text-muted">{s.latency_ms} ms</span>
                        {s.model_used && <span className="text-base text-muted">· {s.model_used}</span>}
                        {typeof s.cost_estimate === 'number' && s.cost_estimate > 0 && <span className="text-base text-muted">· ${s.cost_estimate.toFixed(5)}</span>}
                      </div>
                      {s.note && s.stage !== 'guardrails' && <p className="mt-1 break-words text-base text-muted">{s.note}</p>}
                    </li>
                  ))}
                </ol>
              </section>

              {layers.length > 0 && (
                <section aria-labelledby="why-guard">
                  <h3 id="why-guard" className="text-lg font-bold">Safety layer</h3>
                  <ol className="mt-2 space-y-2">
                    {layers.map((l, i) => (
                      <li key={i} className="rounded-xl border-2 border-line p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold capitalize">{l.layer}</span>
                          <Badge tone={l.status === 'fired' ? 'bad' : l.status === 'modified' ? 'warn' : 'ok'}>{l.status}</Badge>
                        </div>
                        {l.notes.length > 0 && (
                          <ul className="mt-1 list-disc pl-6 text-base text-muted">
                            {l.notes.map((n, j) => (
                              <li key={j} className="break-words">{n}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                  {data.guard?.suppressed && (
                    <details className="mt-3 rounded-xl border-2 border-bad p-3">
                      <summary className="cursor-pointer font-semibold">Suppressed model output (logged for review, never spoken)</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{data.guard.suppressed}</pre>
                    </details>
                  )}
                </section>
              )}

              {data.description && (
                <details className="rounded-xl border-2 border-line p-3">
                  <summary className="cursor-pointer font-semibold">Structured description after the safety layer</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{JSON.stringify(data.description, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
