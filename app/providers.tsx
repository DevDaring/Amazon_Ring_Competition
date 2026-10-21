'use client'

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { UiCommand } from '@/lib/qa/commands'
import { runCommand as executeCommand } from './lib/runCommand'
import { Announcement, Device, LANG_BCP47, Language, Settings, StageMsg } from './lib/types'

interface AppState {
  settings: Settings | null
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  devices: Device[]
  deviceError: string | null
  refreshDevices: () => void
  selectedDevice: Device | null
  announcements: Announcement[]
  latest: Announcement | null
  stages: Record<string, StageMsg[]>
  stageOrder: string[]
  metricsTick: number
  connected: boolean
  soundEnabled: boolean
  enableSound: () => void
  replay: (a: Announcement) => void
  flash: { colour: string; text: string } | null
  liveText: string
  whyId: string | null
  openWhy: (id: string | null) => void
  /** Carries out a voice command and speaks the result; returns the feedback text. */
  runCommand: (cmd: UiCommand) => string
}

const Ctx = createContext<AppState | null>(null)
export const useApp = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

const FLASH: Record<string, string> = {
  doorbell: 'var(--flash-doorbell)',
  person: 'var(--flash-person)',
  vehicle: 'var(--flash-vehicle)',
  package: 'var(--flash-package)',
}

const VIBRATE: Record<string, number[]> = {
  doorbell: [300, 120, 300, 120, 300],
  person: [250, 120, 250],
  vehicle: [500],
  package: [150, 80, 150, 80, 150],
}

function readLocal(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeLocal(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private mode: fine */
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [stages, setStages] = useState<Record<string, StageMsg[]>>({})
  const [stageOrder, setStageOrder] = useState<string[]>([])
  const [metricsTick, setMetricsTick] = useState(0)
  const [connected, setConnected] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [flash, setFlash] = useState<{ colour: string; text: string } | null>(null)
  const [liveText, setLiveText] = useState('')
  const [whyId, setWhyId] = useState<string | null>(null)
  const router = useRouter()
  // The caregiver digest and the Ring account-link pages are public (no site password);
  // they must not call the password-protected APIs, or the browser would ask for it.
  const pathname = usePathname()
  const isPublicPage = pathname.startsWith('/digest/') || pathname.startsWith('/link')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const latestRef = useRef<Announcement | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  const soundRef = useRef(false)
  settingsRef.current = settings
  soundRef.current = soundEnabled

  useEffect(() => {
    if (isPublicPage) return
    fetch('/api/settings').then((r) => r.json()).then(setSettings).catch(() => {})
    setSoundEnabled(readLocal('dv-sound') === 'on')
  }, [isPublicPage])

  const refreshDevices = useCallback(() => {
    if (isPublicPage) return
    fetch('/api/ring/devices')
      .then(async (r) => {
        const d = await r.json()
        setDevices(d.devices ?? [])
        setDeviceError(d.error ?? null)
      })
      .catch((e) => setDeviceError(String(e)))
  }, [isPublicPage])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshDevices, [refreshDevices])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (r.ok) setSettings(await r.json())
  }, [])

  // Pick the first camera once devices load.
  useEffect(() => {
    if (settings && !settings.selectedDeviceId && devices[0]) updateSettings({ selectedDeviceId: devices[0].id })
  }, [settings, devices, updateSettings])

  const speakWithBrowser = (text: string, lang: string, rate: number) => {
    if (!('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = LANG_BCP47[(lang as Language) ?? 'en'] ?? 'en-GB'
    u.rate = rate
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }

  const present = useCallback((a: Announcement, isReplay = false) => {
    const s = settingsRef.current
    // Mirror to the assertive live region. Clearing first makes screen readers re-announce identical text.
    setLiveText('')
    setTimeout(() => setLiveText(a.text), 50)
    if (s?.mode === 'visual') {
      setFlash({ colour: FLASH[a.category] ?? 'var(--flash-other)', text: a.text })
      setTimeout(() => setFlash(null), 2600)
      if ('vibrate' in navigator) navigator.vibrate(VIBRATE[a.category] ?? [400])
      return
    }
    if (!soundRef.current && !isReplay) return
    const rate = s?.speechRate ?? 1
    if (a.audioUrl) {
      const el = audioRef.current ?? new Audio()
      audioRef.current = el
      el.src = a.audioUrl
      el.playbackRate = rate
      el.play().catch(() => speakWithBrowser(a.text, a.language, rate))
    } else {
      speakWithBrowser(a.text, a.language, rate)
    }
  }, [])

  // Server-sent events: stage progress + announcements.
  useEffect(() => {
    if (isPublicPage) return
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      es = new EventSource('/api/stream')
      es.onopen = () => setConnected(true)
      es.onerror = () => {
        setConnected(false)
        es?.close()
        retry = setTimeout(connect, 3000)
      }
      es.onmessage = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.kind === 'announcement') {
          const a: Announcement = msg.announcement
          setAnnouncements((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 30))
          if (!msg.replay) present(a)
        } else if (msg.kind === 'stage') {
          const st: StageMsg = msg
          setStages((all) => ({ ...all, [st.eventId]: [...(all[st.eventId] ?? []).filter((x) => x.stage !== st.stage), st] }))
          setStageOrder((o) => (o.includes(st.eventId) ? o : [st.eventId, ...o].slice(0, 12)))
        } else if (msg.kind === 'metrics') {
          setMetricsTick((t) => t + 1)
        }
      }
    }
    connect()
    return () => {
      clearTimeout(retry)
      es?.close()
    }
  }, [present, isPublicPage])

  const enableSound = useCallback(() => {
    setSoundEnabled(true)
    writeLocal('dv-sound', 'on')
    // A user gesture unlocks audio playback for the session.
    const el = audioRef.current ?? new Audio()
    audioRef.current = el
    el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
    el.play().catch(() => {})
  }, [])

  latestRef.current = announcements[0] ?? null

  // Feedback for commands: the assertive live region for screen readers, and the
  // browser voice for everyone else in Voice mode.
  const notify = useCallback((text: string) => {
    setLiveText('')
    setTimeout(() => setLiveText(text), 50)
    const s = settingsRef.current
    if (s?.mode === 'voice' && soundRef.current) speakWithBrowser(text, 'en', s.speechRate ?? 1)
  }, [])

  const runCommand = useCallback(
    (cmd: UiCommand) => {
      const msg = executeCommand(cmd, {
        navigate: (path) => router.push(path),
        updateSettings: (patch) => void updateSettings(patch),
        latest: latestRef.current,
        replay: (a) => present(a, true),
        openWhy: setWhyId,
      })
      if (msg) notify(msg)
      return msg
    },
    [router, updateSettings, present, notify]
  )

  const selectedDevice = useMemo(() => devices.find((d) => d.id === settings?.selectedDeviceId) ?? devices[0] ?? null, [devices, settings])

  const value: AppState = {
    settings,
    updateSettings,
    devices,
    deviceError,
    refreshDevices,
    selectedDevice,
    announcements,
    latest: announcements[0] ?? null,
    stages,
    stageOrder,
    metricsTick,
    connected,
    soundEnabled,
    enableSound,
    replay: (a) => present(a, true),
    flash,
    liveText,
    whyId,
    openWhy: setWhyId,
    runCommand,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
