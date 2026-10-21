'use client'

import { useEffect, useState } from 'react'
import { useApp } from '../providers'
import { ConfidenceBadge, FeedbackButtons } from '../components/AnnouncementCard'
import { Badge, Button, PageTitle, cn } from '../components/ui'

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'doorbell', label: 'Doorbell' },
  { id: 'human', label: 'People' },
  { id: 'vehicle', label: 'Vehicles' },
  { id: 'motion', label: 'Other motion' },
]

const TYPE_LABEL: Record<string, string> = { button_press: 'Doorbell', motion_detected: 'Motion', device_offline: 'Offline', device_online: 'Online' }

export default function TimelinePage() {
  const { metricsTick, openWhy } = useApp()
  const [filter, setFilter] = useState('')
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/events?limit=100${filter ? `&type=${filter}` : ''}`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .finally(() => setLoading(false))
  }, [filter, metricsTick])

  const play = (url: string) => new Audio(url).play().catch(() => {})

  return (
    <div>
      <PageTitle sub="Everything DoorVoice heard about in the last days, newest first. Silent events were filtered out before speaking.">Timeline</PageTitle>
      <div role="group" aria-label="Filter events" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? 'primary' : 'secondary'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </Button>
        ))}
      </div>
      <p role="status" className="sr-only">
        {loading ? 'Loading events' : `${events.length} events`}
      </p>
      {!loading && !events.length && <p className="text-xl text-muted">No events yet.</p>}
      <ol className="space-y-3">
        {events.map((e) => (
          <li key={e.id} className={cn('rounded-xl2 border-2 border-line bg-surface p-5', e.status === 'silent' && 'opacity-90')}>
            <article aria-label={`${TYPE_LABEL[e.type] ?? e.type} at ${new Date(e.receivedAt).toLocaleString()}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-base text-muted">
                <time dateTime={e.receivedAt}>{new Date(e.receivedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</time>
                <Badge>{TYPE_LABEL[e.type] ?? e.type}{e.subType ? ` · ${e.subType}` : ''}</Badge>
                {e.simulated && <Badge tone="warn">Simulated webhook</Badge>}
                {e.status === 'silent' && <Badge>Not spoken</Badge>}
                {e.status === 'processing' && <Badge tone="accent">Processing</Badge>}
                {e.guardFired && <Badge tone="bad">Safety fallback</Badge>}
                <ConfidenceBadge value={e.confidence} />
                {typeof e.totalMs === 'number' && <span>{(e.totalMs / 1000).toFixed(1)} s</span>}
              </div>
              <p className="text-xl font-semibold">{e.narration ?? (e.status === 'silent' ? 'Filtered before speaking (see Why).' : '…')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {e.audioUrl && (
                  <Button size="sm" onClick={() => play(e.audioUrl)}>
                    Replay
                  </Button>
                )}
                <Button size="sm" onClick={() => openWhy(e.id)}>
                  Why?
                </Button>
              </div>
              {e.status === 'announced' && (
                <div className="mt-2">
                  <FeedbackButtons eventId={e.id} initial={e.feedback} />
                </div>
              )}
            </article>
          </li>
        ))}
      </ol>
    </div>
  )
}
