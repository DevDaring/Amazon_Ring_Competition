'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useApp } from '../providers'
import { LANG_BCP47, LANG_LABEL, Language } from '../lib/types'
import { Button, cn } from './ui'
import { WhyDialog } from './WhyDialog'

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/live', label: 'Live' },
  { href: '/timeline', label: 'Timeline' },
  { href: '/expecting', label: 'Expecting' },
  { href: '/caregiver', label: 'Caregiver' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/settings', label: 'Settings' },
]

export function AppShell({ children, demoMode }: { children: React.ReactNode; demoMode: boolean }) {
  const app = useApp()
  const pathname = usePathname()
  const router = useRouter()
  const mainRef = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const nav = demoMode ? [...NAV, { href: '/demo', label: 'Demo' }] : NAV
  const bare = pathname.startsWith('/digest/') || pathname.startsWith('/link')

  // Focus management: after client-side navigation, move focus to the page heading
  // so screen-reader users hear where they are.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const h1 = mainRef.current?.querySelector('h1') as HTMLElement | null
    if (h1) {
      h1.tabIndex = -1
      h1.focus()
    }
  }, [pathname])

  // Keyboard shortcuts: Alt+1..8 navigate, Alt+R replay, Alt+W why (Alt+T is push-to-talk).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= nav.length) {
        e.preventDefault()
        router.push(nav[n - 1].href)
      } else if (e.key.toLowerCase() === 'r' && app.latest) {
        e.preventDefault()
        app.replay(app.latest)
      } else if (e.key.toLowerCase() === 'w' && app.latest) {
        e.preventDefault()
        app.openWhy(app.latest.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, nav, router])

  // Keep <html lang> in step with the chosen language for correct screen-reader voices.
  useEffect(() => {
    if (app.settings) document.documentElement.lang = LANG_BCP47[app.settings.language as Language].split('-')[0]
  }, [app.settings])

  if (bare) return <main id="main">{children}</main>

  const visual = app.settings?.mode === 'visual'

  return (
    <>
      <a href="#main" className="sr-only-focusable fixed left-3 top-3 z-50 rounded-xl bg-accent px-5 py-3 font-semibold text-accent-ink">
        Skip to main content
      </a>
      <header className="border-b-2 border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-2xl font-bold tracking-tight" aria-label="DoorVoice home">
            DoorVoice
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base text-muted" aria-live="polite">
              {app.connected ? 'Listening for events' : 'Reconnecting…'}
            </span>
            <LanguageToggle />
            <ModeToggle />
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto max-w-6xl px-2">
          <ul className="flex flex-wrap gap-1 pb-2">
            {nav.map((n, i) => {
              const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href)
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    aria-keyshortcuts={`Alt+${i + 1}`}
                    className={cn('inline-flex min-h-[44px] items-center rounded-xl px-4 font-semibold', active ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-raised')}
                  >
                    {n.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </header>

      {!app.soundEnabled && app.settings?.mode === 'voice' && (
        <div role="region" aria-label="Sound" className="border-b-2 border-line bg-raised">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p>Browsers need one tap before DoorVoice can speak.</p>
            <Button variant="primary" onClick={app.enableSound}>
              Turn on spoken announcements
            </Button>
          </div>
        </div>
      )}

      <main id="main" ref={mainRef} tabIndex={-1} className={cn('mx-auto max-w-6xl px-4 py-6 outline-none', visual && 'pb-56')}>
        {children}
      </main>

      {/* Every announcement is mirrored here for screen readers. */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {app.liveText}
      </div>

      <AnimatePresence>
        {app.flash && (
          <motion.div
            key="flash"
            role="alert"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-8"
            style={{ background: app.flash.colour }}
          >
            <p className="max-w-4xl text-center text-4xl font-bold leading-tight text-white sm:text-6xl">{app.flash.text}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {visual && (
        <aside aria-label="Transcript" className="fixed inset-x-0 bottom-0 z-30 max-h-52 overflow-y-auto border-t-4 border-accent bg-surface px-4 py-3">
          <h2 className="text-base font-bold text-muted">Transcript</h2>
          <ol className="mx-auto max-w-6xl space-y-1">
            {app.announcements.slice(0, 8).map((a) => (
              <li key={a.id} className="text-xl">
                <span className="mr-2 text-base text-muted">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {a.text}
              </li>
            ))}
            {!app.announcements.length && <li className="text-lg text-muted">Nothing yet.</li>}
          </ol>
        </aside>
      )}

      <WhyDialog />
    </>
  )
}

function LanguageToggle() {
  const { settings, updateSettings } = useApp()
  if (!settings) return null
  return (
    <div role="group" aria-label="Language" className="flex rounded-xl border-2 border-line">
      {(Object.keys(LANG_LABEL) as Language[]).map((l) => (
        <button
          key={l}
          lang={l}
          aria-pressed={settings.language === l}
          onClick={() => updateSettings({ language: l })}
          className={cn('min-h-[44px] px-3 font-semibold first:rounded-l-[10px] last:rounded-r-[10px]', settings.language === l ? 'bg-accent text-accent-ink' : 'hover:bg-raised')}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  )
}

function ModeToggle() {
  const { settings, updateSettings } = useApp()
  if (!settings) return null
  return (
    <div role="group" aria-label="Announcement mode" className="flex rounded-xl border-2 border-line">
      {(['voice', 'visual'] as const).map((m) => (
        <button
          key={m}
          aria-pressed={settings.mode === m}
          onClick={() => updateSettings({ mode: m })}
          className={cn('min-h-[44px] px-3 font-semibold first:rounded-l-[10px] last:rounded-r-[10px]', settings.mode === m ? 'bg-accent text-accent-ink' : 'hover:bg-raised')}
        >
          {m === 'voice' ? 'Voice' : 'Visual'}
        </button>
      ))}
    </div>
  )
}
