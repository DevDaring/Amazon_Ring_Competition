'use client'

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../providers'
import { LANG_LABEL, Language } from '../lib/types'
import { Badge, Button, Card, Field, PageTitle, inputClass } from '../components/ui'

export default function CaregiverPage() {
  const { settings, updateSettings } = useApp()
  const [digest, setDigest] = useState<any>(null)
  const [caregivers, setCaregivers] = useState<any[]>([])
  const [label, setLabel] = useState('')
  const [lang, setLang] = useState<Language>('en')
  const [copied, setCopied] = useState('')

  const load = useCallback(() => {
    fetch(`/api/digest?lang=${lang}`).then((r) => r.json()).then(setDigest)
    fetch('/api/caregiver').then((r) => r.json()).then((d) => setCaregivers(d.caregivers ?? []))
  }, [lang])
  useEffect(load, [load])

  const link = async () => {
    await fetch('/api/caregiver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })
    setLabel('')
    load()
  }
  const unlink = async (id: string) => {
    await fetch(`/api/caregiver?id=${id}`, { method: 'DELETE' })
    load()
  }
  const shareUrl = (t: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/digest/${t}`

  return (
    <div className="space-y-6">
      <PageTitle sub="A daily, text-only summary for a family member. No video or pictures are ever shared.">Caregiver</PageTitle>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">While you were out</h2>
          <div className="flex items-center gap-2">
            <label htmlFor="dlang" className="font-semibold">
              Language
            </label>
            <select id="dlang" className={inputClass + ' w-auto'} value={lang} onChange={(e) => setLang(e.target.value as Language)}>
              {(Object.keys(LANG_LABEL) as Language[]).map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {digest ? (
          <>
            <p className="mt-3 text-2xl font-semibold" lang={lang}>
              {digest.text}
            </p>
            {digest.anomaly && (
              <p className="mt-2" role="alert">
                <Badge tone="bad">Anomaly</Badge> {digest.anomaly}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Deliveries', digest.counts.deliveries],
                ['Visitors', digest.counts.visitors],
                ['Doorbell presses', digest.counts.doorbell],
                ['Live views', digest.counts.liveViews],
              ].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-raised p-3">
                  <dt className="text-base text-muted">{k}</dt>
                  <dd className="text-3xl font-bold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-base text-muted">Sources: {digest.sources.join('; ')}.</p>
          </>
        ) : (
          <p role="status">Building digest…</p>
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="text-2xl font-bold">Linked caregivers</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            link()
          }}
        >
          <div className="min-w-[14rem] flex-1">
            <Field id="cg-label" label="Name for this link" hint="Only you see this, e.g. “Daughter in Pune”.">
              <input id="cg-label" className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="primary">
            Create digest link
          </Button>
        </form>
        <ul className="space-y-2">
          {caregivers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-line p-3">
              <div className="min-w-0">
                <p className="font-semibold">{c.label}</p>
                <p className="break-all text-base text-muted">{shareUrl(c.shareToken)}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(shareUrl(c.shareToken))
                    setCopied(c.id)
                  }}
                >
                  {copied === c.id ? 'Copied' : 'Copy link'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => unlink(c.id)}>
                  Unlink
                </Button>
              </div>
            </li>
          ))}
          {!caregivers.length && <li className="text-muted">No caregiver linked yet.</li>}
        </ul>
      </Card>

      {settings && (
        <Card>
          <Field id="anomaly" label="Anomaly alert" hint="Add a line to the digest when the door has been quiet for this many hours.">
            <div className="flex items-center gap-3">
              <input
                id="anomaly"
                type="number"
                min={6}
                max={168}
                className={inputClass + ' w-32'}
                value={settings.anomalyHours}
                onChange={(e) => updateSettings({ anomalyHours: Math.max(6, Math.min(168, Number(e.target.value) || 36)) })}
              />
              <span>hours</span>
            </div>
          </Field>
        </Card>
      )}
    </div>
  )
}
