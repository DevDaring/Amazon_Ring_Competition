'use client'

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../providers'
import { Badge, Button, Card, Field, PageTitle, Switch, inputClass } from '../components/ui'

const ANNOUNCE: Array<[keyof NonNullable<ReturnType<typeof useApp>['settings']>['announce'], string]> = [
  ['button_press', 'Doorbell presses'],
  ['person', 'People'],
  ['vehicle', 'Vehicles'],
  ['package', 'Parcels'],
  ['animal', 'Animals'],
  ['motion', 'Other motion'],
]

export default function SettingsPage() {
  const { settings, updateSettings, devices, refreshDevices } = useApp()
  const [health, setHealth] = useState<any>(null)
  const [token, setToken] = useState('')
  const [tokenMsg, setTokenMsg] = useState('')
  const [dataMsg, setDataMsg] = useState('')
  const [datasetSize, setDatasetSize] = useState<number | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const loadHealth = useCallback(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth)
    fetch('/api/data').then((r) => r.json()).then((d) => setDatasetSize(d.datasetSize))
  }, [])
  useEffect(loadHealth, [loadHealth])

  const saveToken = async () => {
    setTokenMsg('Checking token with Ring…')
    const r = await fetch('/api/ring/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
    const d = await r.json()
    setTokenMsg(r.ok ? `Connected. ${d.devices} camera(s) found.` : d.error)
    if (r.ok) setToken('')
    refreshDevices()
    loadHealth()
  }

  const data = async (action: 'export' | 'retention' | 'wipe') => {
    setDataMsg('Working…')
    const r = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    const d = await r.json()
    if (action === 'export') setDataMsg(`Exported ${d.exported} new example(s); dataset holds ${d.total}.${d.s3 ? ' Also copied to S3.' : ' Saved in data/dataset.'}`)
    if (action === 'retention') setDataMsg(`Deleted ${d.events} old event(s) and ${d.files} file(s).`)
    if (action === 'wipe') setDataMsg('All events, pictures, audio, expectations and corrections were deleted.')
    setConfirmWipe(false)
    loadHealth()
  }

  if (!settings) return <p role="status">Loading settings…</p>
  const expires = health?.ring?.expiresAt ? Math.round((health.ring.expiresAt - Date.now()) / 60000) : null

  return (
    <div className="space-y-6">
      <PageTitle>Settings</PageTitle>

      <Card className="space-y-3">
        <h2 className="text-2xl font-bold">Ring connection</h2>
        <p className="flex flex-wrap items-center gap-2">
          {health?.ring?.mode === 'none' ? <Badge tone="bad">Not connected</Badge> : <Badge tone={expires !== null && expires <= 0 ? 'bad' : 'ok'}>{health?.ring?.mode === 'linked_account' ? 'Linked Ring account (refreshes itself)' : health?.ring?.mode === 'refresh_token' ? 'Refresh token' : 'Playground token'}</Badge>}
          {expires !== null && <span>{expires > 0 ? `Token expires in about ${expires} min.` : 'Token expired.'}</span>}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveToken()
          }}
          className="space-y-2"
        >
          <Field id="tok" label="Paste a Developer Playground token" hint="Playground tokens last about 30 minutes. It stays on this computer and is never sent to the browser again.">
            <input id="tok" className={inputClass} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Button type="submit" variant="primary" disabled={!token}>
            Save token
          </Button>
        </form>
        <p role="status">{tokenMsg}</p>
        {health && (
          <p className="break-all text-base text-muted">
            Webhook URL to register in the Ring Developer Portal: <code>{health.webhookUrl}</code>
          </p>
        )}
      </Card>

      {devices.length > 0 && (
        <Card className="space-y-4">
          <h2 className="text-2xl font-bold">Cameras</h2>
          {devices.map((d) => {
            const cam = settings.cameras[d.id] ?? { name: '', kind: 'outdoor' as const }
            const set = (patch: Partial<typeof cam>) => updateSettings({ cameras: { ...settings.cameras, [d.id]: { ...cam, ...patch } } })
            return (
              <fieldset key={d.id} className="space-y-2 rounded-xl border-2 border-line p-4">
                <legend className="px-2 font-semibold">{d.name}</legend>
                <Field id={`n-${d.id}`} label="Name to speak" hint="Leave empty to use the Ring name.">
                  <input id={`n-${d.id}`} className={inputClass} defaultValue={cam.name} onBlur={(e) => set({ name: e.target.value.slice(0, 40) })} placeholder={d.name} />
                </Field>
                <Field id={`k-${d.id}`} label="Where is it?">
                  <select id={`k-${d.id}`} className={inputClass} value={cam.kind} onChange={(e) => set({ kind: e.target.value as 'outdoor' | 'indoor' })}>
                    <option value="outdoor">Outdoor (door, porch, drive)</option>
                    <option value="indoor">Indoor</option>
                  </select>
                </Field>
                <p className="text-base text-muted">
                  {d.online ? 'Online' : 'Offline'} · {d.power === 'battery' ? 'battery' : 'wired'} · {d.e2ee ? 'end-to-end encrypted' : 'not encrypted'} · {d.privacyZones.length} privacy zone(s)
                </p>
              </fieldset>
            )
          })}
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-2xl font-bold">Voice</h2>
        <Field id="rate" label={`Speaking speed: ${settings.speechRate.toFixed(1)}×`}>
          <input id="rate" type="range" min={0.6} max={1.6} step={0.1} value={settings.speechRate} onChange={(e) => updateSettings({ speechRate: Number(e.target.value) })} className="h-12 w-full accent-[var(--accent)]" />
        </Field>
      </Card>

      <Card>
        <h2 className="text-2xl font-bold">Announce</h2>
        {ANNOUNCE.map(([k, label]) => (
          <Switch key={k} id={`a-${k}`} label={label} checked={settings.announce[k]} onCheckedChange={(v) => updateSettings({ announce: { ...settings.announce, [k]: v } })} />
        ))}
        {settings.mutes.length > 0 && (
          <div className="mt-3">
            <h3 className="font-semibold">Muted with “Mute this type”</h3>
            <ul className="mt-1 space-y-1">
              {settings.mutes.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>{m.category}</span>
                  <Button size="sm" variant="ghost" onClick={() => updateSettings({ mutes: settings.mutes.filter((_, j) => j !== i) })}>
                    Unmute
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-2xl font-bold">Quiet hours</h2>
        <Switch id="qh" label="Quiet hours" description="Unexpected events get a gentler, earlier alert. Expected arrivals still speak." checked={settings.quietHours.enabled} onCheckedChange={(v) => updateSettings({ quietHours: { ...settings.quietHours, enabled: v } })} />
        <div className="flex flex-wrap gap-4">
          <Field id="qs" label="From">
            <input id="qs" type="time" className={inputClass} value={settings.quietHours.start} onChange={(e) => updateSettings({ quietHours: { ...settings.quietHours, start: e.target.value } })} />
          </Field>
          <Field id="qe" label="Until">
            <input id="qe" type="time" className={inputClass} value={settings.quietHours.end} onChange={(e) => updateSettings({ quietHours: { ...settings.quietHours, end: e.target.value } })} />
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-2xl font-bold">Your data</h2>
        <Field id="ret" label="Keep events for" hint="Pictures, audio and descriptions older than this are deleted every hour.">
          <div className="flex items-center gap-3">
            <input id="ret" type="number" min={1} max={90} className={inputClass + ' w-28'} value={settings.retentionDays} onChange={(e) => updateSettings({ retentionDays: Math.max(1, Math.min(90, Number(e.target.value) || 7)) })} />
            <span>days</span>
          </div>
        </Field>
        <p>
          Correction dataset: <strong>{datasetSize ?? '…'}</strong> labelled example(s).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => data('export')}>Export dataset now</Button>
          <Button onClick={() => data('retention')}>Apply retention now</Button>
          {!confirmWipe ? (
            <Button variant="danger" onClick={() => setConfirmWipe(true)}>
              Wipe all data
            </Button>
          ) : (
            <>
              <Button variant="danger" onClick={() => data('wipe')}>
                Yes, delete everything
              </Button>
              <Button onClick={() => setConfirmWipe(false)}>Cancel</Button>
            </>
          )}
        </div>
        <p role="status">{dataMsg}</p>
      </Card>

      {health && (
        <Card className="space-y-2">
          <h2 className="text-2xl font-bold">System status</h2>
          <ul className="space-y-1 text-lg">
            <li>AWS: {health.aws.configured ? `configured (${health.aws.region})` : 'not configured'}</li>
            <li>Vision models: {health.aws.fast}{health.aws.strong ? ` → ${health.aws.strong}` : ''}</li>
            <li>Judgment check: {health.aws.guardrailId ? 'Bedrock Guardrails' : health.aws.judge}</li>
            <li>Fallbacks: {Object.entries(health.fallbacks).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</li>
          </ul>
          {health.parked.length > 0 && (
            <div>
              <h3 className="font-semibold">Temporarily skipped providers</h3>
              <ul className="list-disc pl-6 text-base">
                {health.parked.map((p: any) => (
                  <li key={p.id} className="break-words">
                    {p.id}: {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {health.warnings.length > 0 && (
            <ul className="list-disc pl-6 text-base text-muted">
              {health.warnings.map((w: string) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
