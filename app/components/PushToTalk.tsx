'use client'

import { useEffect, useState } from 'react'
import { useVoiceCapture } from '../hooks/useVoiceCapture'
import { Button, cn, inputClass } from './ui'

/**
 * Ask the Door. Press once to talk, press again to send (Alt+T). Questions are
 * answered from the camera; commands ("press start live view", "go to settings")
 * are carried out in the page. Typing works for both.
 */
export function PushToTalk({ compact = false }: { compact?: boolean }) {
  const { phase, status, lastQ, browserStt, toggle, ask, active } = useVoiceCapture()
  const [typed, setTyped] = useState('')

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
      <p className="text-muted">“Is anyone still there?” · “What are they holding?” · or a command: “press start live view”, “go to settings”, “help”</p>
      <div className="mt-4 flex flex-wrap items-center gap-3" data-voice-ignore>
        <Button size="lg" variant={active ? 'danger' : 'primary'} aria-pressed={active} aria-keyshortcuts="Alt+T" disabled={phase === 'thinking'} onClick={toggle}>
          {active ? 'Stop and send' : phase === 'thinking' ? 'Thinking…' : 'Push to talk'}
        </Button>
        <span className="text-base text-muted">
          {browserStt ? 'Using this browser’s speech recognition' : 'Shortcut: Alt+T'} · Speak after the beep; it sends when you pause. With a screen reader, headphones stop it being recorded.
        </span>
      </div>
      <form
        className="mt-4 flex flex-wrap gap-2"
        data-voice-ignore
        onSubmit={(e) => {
          e.preventDefault()
          if (typed.trim()) ask({ question: typed.trim() })
          setTyped('')
        }}
      >
        <label htmlFor="typed-q" className="sr-only">
          Type a question or command
        </label>
        <input id="typed-q" className={cn(inputClass, 'flex-1 min-w-[12rem]')} placeholder="Or type a question or command" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button type="submit" disabled={phase === 'thinking'}>
          Ask
        </Button>
      </form>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.5em] text-base">
        {status}
      </p>
      {lastQ && (
        <div className="mt-2 rounded-xl bg-raised p-4">
          <p className="text-base text-muted">You said: {lastQ.q}</p>
          <p className="text-xl font-semibold">{lastQ.a}</p>
        </div>
      )}
    </section>
  )
}
