'use client'

import { useCallback, useRef, useState } from 'react'
import { useApp } from '../providers'
import { LANG_BCP47, Language } from '../lib/types'
import { controlNames } from '../lib/runCommand'

export type Phase = 'idle' | 'preparing' | 'listening' | 'thinking'

// Screen readers speak when the button changes ("Stop and send, pressed"). If the
// microphone opened at once it would record that speech instead of the user. So:
// change the button and a short status first, wait for the screen reader to finish,
// play a beep, and only then start listening, without touching the page again.
const LISTEN_DELAY_MS = 1500
// Stop by itself once the user has spoken and then been quiet this long.
const SILENCE_STOP_MS = 1200
const MAX_LISTEN_MS = 10_000

/** Calls onSilence after speech followed by a pause. Returns a cleanup function. */
function watchForSilence(stream: MediaStream, onSilence: () => void): () => void {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    let heardSpeech = false
    let quietSince = 0
    const iv = setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const now = Date.now()
      if (rms > 0.02) {
        heardSpeech = true
        quietSince = 0
      } else if (heardSpeech) {
        quietSince ||= now
        if (now - quietSince > SILENCE_STOP_MS) {
          clearInterval(iv)
          onSilence()
        }
      }
    }, 100)
    return () => {
      clearInterval(iv)
      ctx.close().catch(() => {})
    }
  } catch {
    return () => {}
  }
}

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
 * Push-to-talk shared by "Ask the door" and the top-bar Voice command button.
 * The server decides whether the words were a question (answered through the
 * pipeline and spoken via the announcement stream) or a command (carried out here).
 * Audio goes to Transcribe -> Sarvam -> OpenAI; if that fails, the next attempt uses
 * the browser's own speech recognition.
 */
export function useVoiceCapture() {
  const { settings, selectedDevice, runCommand } = useApp()
  const lang = (settings?.language ?? 'en') as Language
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState('')
  const [lastQ, setLastQ] = useState<{ q: string; a: string } | null>(null)
  const [browserStt, setBrowserStt] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const srRef = useRef<any>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const prepTimer = useRef<ReturnType<typeof setTimeout>>()
  const streamRef = useRef<MediaStream | null>(null)
  const silenceRef = useRef<() => void>(() => {})

  const ask = useCallback(
    async (body: FormData | { question: string; source?: 'speech' }) => {
      setPhase('thinking')
      setStatus('Thinking…')
      try {
        const isForm = body instanceof FormData
        // The buttons on screen, so a free-form command can be matched to a real control.
        const controls = controlNames(60, false)
        if (isForm) {
          body.append('lang', lang)
          if (selectedDevice) body.append('deviceId', selectedDevice.id)
          body.append('controls', JSON.stringify(controls))
        }
        const r = await fetch('/api/ask', {
          method: 'POST',
          ...(isForm ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, lang, deviceId: selectedDevice?.id, controls }) }),
        })
        const d = await r.json()
        if (!r.ok) {
          if (isForm && 'webkitSpeechRecognition' in window) setBrowserStt(true)
          setStatus(`${d.error ?? 'Something went wrong.'}${isForm ? ' Next time I will use this browser’s speech recognition.' : ''}`)
        } else if (d.intent === 'command') {
          // Feedback is spoken by runCommand; keep the status empty so it is not read twice.
          setStatus('')
          setLastQ({ q: d.question, a: runCommand(d.command) })
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
    [lang, selectedDevice, runCommand]
  )

  const stop = useCallback(() => {
    clearTimeout(timer.current)
    silenceRef.current()
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
        setStatus('I did not catch that. Try again or type it.')
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
        silenceRef.current = watchForSilence(stream, () => {
          if (rec.state === 'recording') stop()
        })
        timer.current = setTimeout(stop, MAX_LISTEN_MS) // questions are short
      }, LISTEN_DELAY_MS)
    } catch {
      setStatus('Microphone not available. Type instead.')
    }
  }, [ask, browserStt, lang, stop])

  const toggle = useCallback(() => {
    if (phase === 'listening' || phase === 'preparing') stop()
    else if (phase === 'idle') start()
  }, [phase, start, stop])

  return { phase, status, lastQ, browserStt, toggle, ask, active: phase === 'listening' || phase === 'preparing' }
}
