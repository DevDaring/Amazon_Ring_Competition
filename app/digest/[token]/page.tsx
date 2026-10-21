'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { LANG_LABEL, Language } from '../../lib/types'

/** The caregiver's shareable page: text only, screen-reader friendly, no video. */
export default function SharedDigest() {
  const { token } = useParams<{ token: string }>()
  const [lang, setLang] = useState<Language>('en')
  const [d, setD] = useState<any>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/digest?token=${encodeURIComponent(token)}&lang=${lang}`)
      .then(async (r) => (r.ok ? setD(await r.json()) : setError((await r.json()).error)))
      .catch((e) => setError(String(e)))
  }, [token, lang])
  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <h1 className="text-3xl font-bold">While you were out</h1>
      <p className="text-muted">A DoorVoice summary of door activity. Text only; no pictures or video are shared.</p>
      <div role="group" aria-label="Language" className="flex flex-wrap gap-2">
        {(Object.keys(LANG_LABEL) as Language[]).map((l) => (
          <button key={l} lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} className="min-h-[44px] rounded-xl border-2 border-line px-4 font-semibold aria-pressed:bg-accent aria-pressed:text-accent-ink">
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-xl">{error}</p>}
      {d && (
        <article className="rounded-xl2 border-2 border-line bg-surface p-6">
          <p className="text-2xl font-semibold" lang={lang}>
            {d.text}
          </p>
          <p className="mt-4 text-base text-muted">Covers the last {d.periodHours} hours · generated {new Date(d.generatedAt).toLocaleString()}</p>
        </article>
      )}
    </div>
  )
}
