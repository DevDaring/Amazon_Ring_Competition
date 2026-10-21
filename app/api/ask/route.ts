import { NextRequest, NextResponse } from 'next/server'
import { LANGUAGES, Language } from '@/lib/pipeline/types'
import { providers, sttFor, withFallback } from '@/lib/providers/registry'
import { askDoor } from '@/lib/qa/ask'
import { getSettings } from '@/lib/server/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ask the Door. Accepts either JSON {question} (typed, or recognised by the browser's
 * own speech engine) or multipart with an audio blob, which goes through
 * Transcribe -> Sarvam -> OpenAI speech-to-text.
 */
export async function POST(req: NextRequest) {
  const settings = await getSettings()
  let question = ''
  let lang = settings.language as Language
  let deviceId: string | null = settings.selectedDeviceId
  let stt: { provider: string; ms: number } | null = null
  const ctype = req.headers.get('content-type') ?? ''
  try {
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData()
      const l = String(form.get('lang') ?? lang)
      if (LANGUAGES.includes(l as Language)) lang = l as Language
      deviceId = (form.get('deviceId') as string) || deviceId
      const audio = form.get('audio')
      if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: 'audio missing' }, { status: 400 })
      if (audio.size > 5_000_000) return NextResponse.json({ error: 'recording too long' }, { status: 413 })
      const buf = Buffer.from(await audio.arrayBuffer())
      const t0 = Date.now()
      const r = await withFallback('stt', providers().stt, (p) => p.transcribe(buf, audio.type, lang), { filter: sttFor(lang) })
      question = r.result.text
      stt = { provider: r.provider, ms: Date.now() - t0 }
    } else {
      const body = await req.json()
      question = String(body.question ?? '')
      if (LANGUAGES.includes(body.lang)) lang = body.lang
      deviceId = body.deviceId ?? deviceId
    }
  } catch (e) {
    return NextResponse.json({ error: `could not understand the question: ${(e as Error).message.slice(0, 200)}` }, { status: 400 })
  }
  question = question.trim().slice(0, 300)
  if (!question) return NextResponse.json({ error: 'I did not catch a question. Please try again.' }, { status: 400 })
  const result = await askDoor(question, { lang, deviceId })
  return NextResponse.json({ ...result, stt })
}
