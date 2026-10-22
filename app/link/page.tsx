'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

/**
 * Ring's one-way account linking lands here with ?nonce=..&time=..
 * The user must sign in (Ring requires it) before we claim the token.
 * The page sits behind DoorVoice's sign-in (the site login on the hosted copy), which is
 * Ring's mandatory partner sign-in; the email given here becomes the masked account_identifier.
 */
function LinkForm() {
  const p = useSearchParams()
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const nonce = p.get('nonce')
  const time = p.get('time')
  const submit = async () => {
    setMsg('Linking…')
    const r = await fetch('/api/ring/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce, time, email }) })
    const d = await r.json()
    setMsg(r.ok ? `Linked. Ring now shows the integration as ${d.completed?.status ?? 'completed'}. Taking you to Settings…` : d.error)
    if (r.ok) setTimeout(() => (window.location.href = '/settings'), 2500)
  }
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <h1 className="text-3xl font-bold">Connect Ring to DoorVoice</h1>
      {!nonce || !time ? (
        <p role="alert">This page is opened from the Ring app during account linking. The link is missing its nonce.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label htmlFor="email" className="block font-semibold">
            Your email (shown to you in the Ring app as the linked DoorVoice account)
          </label>
          <input id="email" type="email" required autoComplete="email" className="min-h-[48px] w-full rounded-xl border-2 border-line bg-surface px-4 text-lg" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="min-h-[48px] rounded-xl bg-accent px-6 font-semibold text-accent-ink">
            Link my Ring account
          </button>
        </form>
      )}
      <p role="status">{msg}</p>
    </div>
  )
}

export default function LinkPage() {
  return (
    <Suspense>
      <LinkForm />
    </Suspense>
  )
}
