'use client'

import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../providers'
import { LANG_BCP47, Language } from '../lib/types'
import { Badge, Button, Card, PageTitle, cn, inputClass } from '../components/ui'

const KIND_LABEL: Record<string, string> = { delivery: 'Delivery', visitor: 'Visitor', vehicle: 'Vehicle', service: 'Service visit' }
const STATUS_TONE: Record<string, 'accent' | 'ok' | 'neutral'> = { pending: 'accent', met: 'ok', expired: 'neutral' }

export default function ExpectingPage() {
  const { settings, metricsTick } = useApp()
  const [text, setText] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const [listening, setListening] = useState(false)

  const load = useCallback(() => {
    fetch('/api/expectations').then((r) => r.json()).then((d) => setItems(d.items ?? []))
  }, [])
  useEffect(load, [load, metricsTick])

  const submit = async (value: string) => {
    if (!value.trim()) return
    setMsg('Saving…')
    const r = await fetch('/api/expectations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: value }) })
    const d = await r.json()
    if (!r.ok) return setMsg(d.error ?? 'Could not save that.')
    setMsg(`Got it: ${d.items.map((i: any) => `${KIND_LABEL[i.kind].toLowerCase()} ${fmt(i.windowStart)}–${fmt(i.windowEnd)}`).join('; ')}.`)
    setText('')
    load()
  }

  const dictate = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SR) return setMsg('Voice input is not available in this browser. Please type instead.')
    const sr = new SR()
    sr.lang = LANG_BCP47[(settings?.language ?? 'en') as Language]
    sr.onresult = (e: any) => {
      const t = e.results[0][0].transcript
      setText(t)
      submit(t)
    }
    sr.onend = () => setListening(false)
    sr.start()
    setListening(true)
    setMsg('Listening…')
  }

  const remove = async (id: string) => {
    await fetch(`/api/expectations?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-6">
      <PageTitle sub="Tell DoorVoice what you are waiting for. It matches parcels, bags, vehicles and time windows, never faces or names.">I’m expecting…</PageTitle>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(text)
          }}
          className="space-y-3"
        >
          <label htmlFor="exp" className="block text-lg font-semibold">
            What are you expecting?
          </label>
          <input id="exp" className={inputClass} value={text} onChange={(e) => setText(e.target.value)} placeholder="a grocery delivery and my sister around 5" aria-describedby="exp-hint" />
          <p id="exp-hint" className="text-base text-muted">
            Examples: “a parcel this afternoon”, “a white van at 3:30pm”, “the plumber between 10 and 12”.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              Add
            </Button>
            <Button type="button" onClick={dictate} aria-pressed={listening}>
              {listening ? 'Listening…' : 'Say it'}
            </Button>
          </div>
          <p role="status" className="min-h-[1.5em] text-base">
            {msg}
          </p>
        </form>
      </Card>

      <section aria-labelledby="exp-list">
        <h2 id="exp-list" className="mb-3 text-2xl font-bold">
          Expectations
        </h2>
        {!items.length && <p className="text-lg text-muted">Nothing expected right now.</p>}
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl2 border-2 border-line bg-surface p-4', i.status !== 'pending' && 'opacity-90')}>
              <div>
                <p className="text-xl font-semibold">
                  {KIND_LABEL[i.kind]}: {i.text}
                  {i.vehicleColour ? ` (${i.vehicleColour}${i.vehicleType ? ' ' + i.vehicleType : ''})` : ''}
                </p>
                <p className="text-base text-muted">
                  {fmt(i.windowStart)} to {fmt(i.windowEnd)}
                  {i.matchedAt ? ` · matched at ${fmt(i.matchedAt)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[i.status]}>{i.status === 'met' ? 'Matched' : i.status === 'pending' ? 'Waiting' : 'Expired'}</Badge>
                <Button size="sm" variant="ghost" onClick={() => remove(i.id)} aria-label={`Remove ${KIND_LABEL[i.kind]} ${i.text}`}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function fmt(d: string) {
  return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
