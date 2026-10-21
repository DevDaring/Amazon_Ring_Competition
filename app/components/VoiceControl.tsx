'use client'

import { useEffect } from 'react'
import { useVoiceCapture } from '../hooks/useVoiceCapture'
import { Button } from './ui'

/**
 * Top-bar voice button, on every screen (Alt+V). Say a command ("press doorbell press",
 * "go to settings", "switch to Hindi", "help") or a question about the door.
 */
export function VoiceControl() {
  const { phase, status, toggle, active } = useVoiceCapture()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return (
    <div className="flex items-center gap-2" data-voice-ignore>
      <Button size="sm" variant={active ? 'danger' : 'primary'} aria-pressed={active} aria-keyshortcuts="Alt+V" disabled={phase === 'thinking'} onClick={toggle}>
        {active ? 'Stop and send' : phase === 'thinking' ? 'Working…' : 'Voice command'}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  )
}
