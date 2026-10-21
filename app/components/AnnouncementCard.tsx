'use client'

import { useState } from 'react'
import { useApp } from '../providers'
import type { Announcement } from '../lib/types'
import { Badge, Button } from './ui'

export function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  if (typeof value !== 'number') return null
  const pct = Math.round(value * 100)
  const label = value >= 0.8 ? 'sure' : value >= 0.5 ? 'likely' : 'unsure'
  return <Badge tone={value >= 0.8 ? 'ok' : value >= 0.5 ? 'warn' : 'bad'}>{`${label}, ${pct}%`}</Badge>
}

/** Correct / Wrong / Mute this type. Each tap becomes a labelled training example. */
export function FeedbackButtons({ eventId, initial, onDone }: { eventId: string; initial?: string | null; onDone?: (datasetSize: number) => void }) {
  const [state, setState] = useState<string | null>(initial ?? null)
  const [msg, setMsg] = useState('')
  const send = async (verdict: 'correct' | 'wrong' | 'mute') => {
    const r = await fetch(`/api/events/${eventId}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict }) })
    const d = await r.json()
    if (r.ok) {
      setState(verdict)
      setMsg(verdict === 'mute' ? `Muted ${d.category} announcements from this camera.` : `Thanks. Saved as a ${verdict} example (${d.datasetSize} in the dataset).`)
      onDone?.(d.datasetSize)
    } else setMsg(d.error ?? 'Could not save.')
  }
  return (
    <div>
      <div role="group" aria-label="Was this right?" className="flex flex-wrap gap-2">
        <Button size="sm" aria-pressed={state === 'correct'} onClick={() => send('correct')}>
          Correct
        </Button>
        <Button size="sm" aria-pressed={state === 'wrong'} onClick={() => send('wrong')}>
          That&apos;s wrong
        </Button>
        <Button size="sm" aria-pressed={state === 'mute'} onClick={() => send('mute')}>
          Mute this type
        </Button>
      </div>
      <p role="status" className="mt-1 text-base text-muted">
        {msg}
      </p>
    </div>
  )
}

export function AnnouncementCard({ a, big = false }: { a: Announcement; big?: boolean }) {
  const { replay, openWhy } = useApp()
  const isEvent = a.source === 'event' && !a.id.startsWith('guardtest-')
  return (
    <article aria-label="Announcement" className="rounded-xl2 border-2 border-line bg-surface p-5 sm:p-6">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-base text-muted">
        <time dateTime={a.at}>{new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
        <span>· {a.cameraName}</span>
        {a.source === 'qa' && <Badge tone="accent">Answer</Badge>}
        {a.source === 'early' && <Badge>Early alert</Badge>}
        {a.simulated && <Badge tone="warn">Simulated</Badge>}
        {a.guardFired && <Badge tone="bad">Safety fallback</Badge>}
        <ConfidenceBadge value={a.confidence} />
      </div>
      <p className={big ? 'text-hero font-semibold' : 'text-2xl font-semibold'}>{a.text}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => replay(a)} aria-keyshortcuts={big ? 'Alt+R' : undefined}>
          Replay
        </Button>
        <Button onClick={() => openWhy(a.id)} aria-keyshortcuts={big ? 'Alt+W' : undefined}>
          Why did it say that?
        </Button>
      </div>
      {isEvent && (
        <div className="mt-3">
          <FeedbackButtons eventId={a.id.replace(/-early$/, '')} />
        </div>
      )}
    </article>
  )
}
