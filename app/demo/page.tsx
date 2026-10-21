'use client'

import { useState } from 'react'
import { useApp } from '../providers'
import { Badge, Button, Card, PageTitle, Switch, inputClass } from '../components/ui'

const EVENTS = [
  { label: 'Doorbell press', type: 'button_press' },
  { label: 'Motion: person', type: 'motion_detected', subType: 'human' },
  { label: 'Motion: vehicle', type: 'motion_detected', subType: 'vehicle' },
  { label: 'Motion: general', type: 'motion_detected', subType: 'motion' },
  { label: 'Motion: other', type: 'motion_detected', subType: 'other_motion' },
  { label: 'Unknown subtype (“drone”)', type: 'motion_detected', subType: 'drone' },
  { label: 'Camera offline', type: 'device_offline' },
]

const GUARD_SAMPLES = [
  { id: 'suspicious', label: '“A suspicious man is lurking…”' },
  { id: 'race_gender', label: 'Race and gender in clothing text' },
  { id: 'name', label: '“That is John Smith, your neighbour.”' },
  { id: 'free_text', label: 'Free text instead of JSON' },
  { id: 'plate', label: 'A licence plate in the summary' },
]

// What the Ring Developer Playground UI offered when we built this (it has no API to list them).
const PLAYGROUND = [
  'Live view of the Playground Device (WHEP) — the stream DoorVoice captures frames from',
  'Simulated live-view events listed by the Playground, including “vehicle”',
  'Event history: on-demand (live view) sessions, retrievable via GET /v1/history',
  'Image and clip download for times when the sandbox camera was recording',
]

export default function DemoPage() {
  const { selectedDevice } = useApp()
  const [file, setFile] = useState<File | null>(null)
  const [replay, setReplay] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [guard, setGuard] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const add = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${s}`, ...l].slice(0, 20))

  const simulate = async (e: (typeof EVENTS)[number]) => {
    setBusy(true)
    const f = new FormData()
    f.append('type', e.type)
    if (e.subType) f.append('subType', e.subType)
    if (selectedDevice) f.append('deviceId', selectedDevice.id)
    if (file) f.append('image', file)
    if (replay) f.append('replay', '1')
    try {
      const r = await fetch('/api/demo/simulate', { method: 'POST', body: f })
      const d = await r.json()
      add(`Simulated webhook “${e.label}”: HTTP ${d.status}, ${d.response?.status ?? d.error} in ${d.ack_ms} ms${d.replay ? `; replayed same request_id → ${d.replay.status}` : ''}`)
    } catch (err) {
      add(`Failed: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const runGuard = async (id: string) => {
    setGuard({ loading: id })
    const r = await fetch('/api/demo/guard-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sample: id }) })
    setGuard(await r.json())
  }

  return (
    <div className="space-y-6">
      <PageTitle sub="Everything on this page is clearly simulated. Webhooks are signed with your HMAC key and sent through the real /api/ring/webhook path.">
        Demo panel <Badge tone="warn">Simulated</Badge>
      </PageTitle>

      <Card className="space-y-4">
        <h2 className="text-2xl font-bold">Simulated webhook</h2>
        <p className="text-muted">
          Camera: {selectedDevice ? selectedDevice.displayName : 'none (a placeholder device id is used)'}. Pictures come from, in order: your uploaded image, the live view (open Live first), a Ring snapshot, or the sandbox’s most recent recording.
        </p>
        <div>
          <label htmlFor="img" className="font-semibold">
            Optional test image (labelled “Simulated” everywhere it appears)
          </label>
          <input id="img" type="file" accept="image/*" className={inputClass + ' py-2'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <Switch id="replay" label="Also replay the same request" description="Sends the identical signed payload twice to show idempotency on meta.request_id." checked={replay} onCheckedChange={setReplay} />
        <div className="flex flex-wrap gap-2">
          {EVENTS.map((e) => (
            <Button key={e.label} onClick={() => simulate(e)} disabled={busy} variant={e.type === 'button_press' ? 'primary' : 'secondary'}>
              {e.label}
            </Button>
          ))}
        </div>
        <ol aria-label="Webhook log" className="space-y-1 font-mono text-base">
          {log.map((l, i) => (
            <li key={i} className="break-words">
              {l}
            </li>
          ))}
        </ol>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-2xl font-bold">Guardrail test</h2>
        <p className="text-muted">Feeds a judgmental model output (simulated) through the real safety layer, including the live judgment check, then speaks whatever survives.</p>
        <div className="flex flex-wrap gap-2">
          {GUARD_SAMPLES.map((g) => (
            <Button key={g.id} onClick={() => runGuard(g.id)} disabled={guard?.loading}>
              {g.label}
            </Button>
          ))}
        </div>
        {guard?.loading && <p role="status">Running…</p>}
        {guard?.result && (
          <div className="space-y-2" role="status">
            <p className="text-xl">
              Spoken: <strong>{guard.spoken}</strong>
            </p>
            <ul className="space-y-1">
              {guard.result.layers.map((l: any, i: number) => (
                <li key={i}>
                  <Badge tone={l.status === 'fired' ? 'bad' : l.status === 'modified' ? 'warn' : 'ok'}>{l.layer}: {l.status}</Badge>{' '}
                  <span className="break-words text-base text-muted">{l.notes.join('; ')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-2xl font-bold">Ring Developer Playground</h2>
        <p className="text-muted">The Playground’s simulations are triggered in its own web UI; there is no API to list or fire them (see docs/FRICTION_LOG.md). What DoorVoice uses from it:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          {PLAYGROUND.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
