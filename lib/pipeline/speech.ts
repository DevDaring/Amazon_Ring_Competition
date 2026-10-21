import { providers, ttsFor, withFallback } from '../providers/registry'
import { saveFile } from '../server/storage'
import type { Language } from './types'

export interface Spoken {
  audioUrl: string | null
  provider: string
  voice?: string
  latencyMs: number
  costUsd: number
  error?: string
}

/**
 * Synthesises an already-guarded sentence. There is deliberately no public
 * "speak this text" endpoint: audio only exists for sentences the pipeline produced.
 * If every TTS provider fails, the browser's own voice reads the same guarded text.
 */
export async function synthesize(id: string, text: string, lang: Language): Promise<Spoken> {
  const t0 = Date.now()
  try {
    const { result } = await withFallback('tts', providers().tts, (p) => p.synthesize(text, lang), { filter: ttsFor(lang) })
    const ext = result.mime.includes('wav') ? 'wav' : 'mp3'
    const name = `${id}.${ext}`
    saveFile('audio', name, result.audio)
    return { audioUrl: `/api/audio/${name}`, provider: result.provider, voice: result.voice, latencyMs: Date.now() - t0, costUsd: result.costUsd }
  } catch (e) {
    return { audioUrl: null, provider: 'browser', latencyMs: Date.now() - t0, costUsd: 0, error: (e as Error).message.slice(0, 200) }
  }
}
