'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../providers'
import { LANG_BCP47, Language } from '../lib/types'
import { Button, cn, inputClass } from './ui'

type Phase = 'idle' | 'preparing' | 'listening' | 'thinking'

// Screen readers speak when the button changes ("Stop and send, pressed"). If the
// microphone opened at once it would record that speech instead of the user. So:
// change the button and a short status first, wait for the screen reader to finish,
// play a beep, and only then start listening, without touching the page again.
const LISTEN_DELAY_MS = 1500

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.2)
    return new Promise<void>((r) => setTimeout(() => (ctx.close(), r()), 250))
  } catch {
    return Promise.resolve()
  }
}

/**
 * Ask the Door. Press once to talk, press again to send (Alt+T works anywhere).
 * Audio goes to the server (Transcribe -> Sarvam -> OpenAI); if that fails, the next
 * question uses the browser's own speech recognition. Typing always works.
 */
export function PushToTalk({ compact = false }: { compact?: boolean }) {
  const { settings, selectedDevice } = useApp()
  const lang = (settings?.language ?? 'en') as Language
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')
  const [typed, setTyped] = useState('')
  const [lastQ, setLastQ] = useState<{ q: string; a: string } | null>(null)
  const [browserStt, setBrowserStt] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const srRef = useRef<any>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const prepTimer = useRef<ReturnType<typeof setTimeout>>()
  const streamRef = useRef<MediaStream | null>(null)

  const ask = useCallback(
    async (body: FormData | { question: string; source?: 'speech' }) => {
      setPhase('thinking')
      setStatus('Thinking…')
      try {
        const isForm = body instanceof FormData
        if (isForm) {
          body.append('lang', lang)
          if (selectedDevice) body.append('deviceId', selectedDevice.id)
        }
        const r = await fetch('/api/ask', {
          method: 'POST',
          ...(isForm ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang, deviceId: selectedDevice?.id }) }),
        })
        const d = await r.json()
        if (!r.ok) {
          if (isForm && 'webkitSpeechRecognition' in window) setBrowserStt(true)
          setStatus(`${d.error ?? 'Something went wrong.'}${isForm ? ' Next time I will use this browser’s speech recognition.' : ''}`)
        } else {
          setLastQ({ q: d.question, a: d.answer })
          setStatus('')
        }
      } catch (e) {
        setStatus(`Could not reach DoorVoice: ${String(e)}`)
      } finally {
        setPhase('idle')
      }
    },
    [lang, selectedDevice]
  )

  const stop = useCallback(() => {
    clearTimeout(timer.current)
    if (prepTimer.current) {
      // Pressed again before the beep: cancel instead of sending an empty recording.
      clearTimeout(prepTimer.current)
      prepTimer.current = undefined
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setPhase('idle')
      setStatus('Cancelled.')
      return
    }
    if (srRef.current) {
      srRef.current.stop()
      return
    }
    recRef.current?.stop()
  }, [])

  const start = useCallback(async () => {
    if (browserStt) {
      const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
      const sr = new SR()
      srRef.current = sr
      sr.lang = LANG_BCP47[lang]
      sr.interimResults = false
      sr.onresult = (e: any) => {
        const q = e.results[0][0].transcript
        srRef.current = null
        ask({ question: q, source: 'speech' })
      }
      sr.onerror = () => {
        srRef.current = null
        setPhase('idle')
        setStatus('I did not catch that. Try again or type your question.')
      }
      sr.onend = () => {
        if (srRef.current) {
          srRef.current = null
          setPhase('idle')
        }
      }
      setPhase('preparing')
      setStatus('Speak after the beep.')
      prepTimer.current = setTimeout(async () => {
        prepTimer.current = undefined
        await beep()
        sr.start()
        setPhase('listening')
      }, LISTEN_DELAY_MS)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      recRef.current = rec
      chunks.current = []
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        const form = new FormData()
        form.append('audio', blob, 'question.webm')
        ask(form)
      }
      setPhase('preparing')
      setStatus('Speak after the beep.')
      prepTimer.current = setTimeout(async () => {
        prepTimer.current = undefined
        await beep()
        rec.start()
        // No status change here: anything new on the page would make the screen reader talk over the user.
        setPhase('listening')
        timer.current = setTimeout(stop, 10_000) // questions are short; stop after 10 s
      }, LISTEN_DELAY_MS)
    } catch {
      setStatus('Microphone not available. Type your question instead.')
    }
  }, [ask, browserStt, lang, stop])

  const toggle = useCallback(() => {
    if (phase === 'listening' || phase === 'preparing') stop()
    else if (phase === 'idle') start()
  }, [phase, start, stop])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <section aria-labelledby="ask-title" className={cn(!compact && 'rounded-xl2 border-2 border-line bg-surface p-5 sm:p-6')}>
      <h2 id="ask-title" className="text-2xl font-bold">
        Ask the door
      </h2>
      <p className="text-muted">“Is anyone still there?” · “What are they holding?” · “Read the label”</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          variant={phase === 'listening' || phase === 'preparing' ? 'danger' : 'primary'}
          aria-pressed={phase === 'listening' || phase === 'preparing'}
          aria-keyshortcuts="Alt+T"
          disabled={phase === 'thinking'}
          onClick={toggle}
        >
          {phase === 'listening' || phase === 'preparing' ? 'Stop and send' : phase === 'thinking' ? 'Thinking…' : 'Push to talk'}
        </Button>
        <span className="text-base text-muted">
          {browserStt ? 'Using this browser’s speech recognition' : 'Shortcut: Alt+T'} · Speak after the beep. With a screen reader, headphones stop it being recorded.
        </span>
      </div>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (typed.trim()) ask({ question: typed.trim() })
          setTyped('')
        }}
      >
        <label htmlFor="typed-q" className="sr-only">
          Type a question
        </label>
        <input id="typed-q" className={cn(inputClass, 'flex-1 min-w-[12rem]')} placeholder="Or type a question" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button type="submit" disabled={phase === 'thinking'}>
          Ask
        </Button>
      </form>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.5em] text-base">
        {status}
      </p>
      {lastQ && (
        <div className="mt-2 rounded-xl bg-raised p-4">
          <p className="text-base text-muted">You asked: {lastQ.q}</p>
          <p className="text-xl font-semibold">{lastQ.a}</p>
        </div>
      )}
    </section>
  )
}
