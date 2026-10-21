import fs from 'node:fs'
import path from 'node:path'
import type { Language } from '../pipeline/types'
import {
  BedrockJudgment,
  BedrockText,
  BedrockVision,
  NovaDetector,
  PollyTTS,
  RekognitionDetector,
  TranscribeSTT,
} from './aws'
import { FishTTS, OpenAISTT, SarvamSTT, SarvamTTS, openAI, openRouter } from './fallbacks'
import type { JudgmentChecker, ObjectDetector, STTProvider, TTSProvider, TextProvider, VisionProvider } from './types'
import { fallbackAlert, isPermanentError, park } from './util'

// AWS first in every chain; the rest only answer when AWS cannot.
let chains: {
  vision: VisionProvider[]
  text: TextProvider[]
  detector: ObjectDetector[]
  judgment: JudgmentChecker[]
  tts: TTSProvider[]
  stt: STTProvider[]
} | null = null

export function providers() {
  if (!chains) {
    chains = {
      vision: [new BedrockVision(), openRouter(), openAI()],
      text: [new BedrockText(), openRouter(), openAI()],
      detector: [new RekognitionDetector(), new NovaDetector()],
      judgment: [new BedrockJudgment()],
      tts: [new PollyTTS(), new SarvamTTS(), new FishTTS()],
      stt: [new TranscribeSTT(), new SarvamSTT(), new OpenAISTT()],
    }
  }
  return chains
}

export interface Attempt {
  provider: string
  ok: boolean
  error?: string
  ms: number
}

const ERROR_LOG = path.join(process.cwd(), 'data', 'provider-errors.jsonl')
function logProviderError(kind: string, provider: string, err: unknown) {
  try {
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true })
    const e = err as any
    fs.appendFileSync(
      ERROR_LOG,
      JSON.stringify({ ts: new Date().toISOString(), kind, provider, name: e?.name, message: String(e?.message ?? e).slice(0, 400) }) + '\n'
    )
  } catch {
    /* logging must not break the pipeline */
  }
}

/**
 * Tries each provider in order. Permission/billing failures park the provider for ten
 * minutes so the next event does not wait on it again.
 */
export async function withFallback<P extends { id: string; available(): boolean }, R>(
  kind: string,
  list: P[],
  run: (p: P) => Promise<R>,
  opts: { filter?: (p: P) => boolean } = {}
): Promise<{ result: R; provider: string; attempts: Attempt[] }> {
  const attempts: Attempt[] = []
  const candidates = list.filter((p) => p.available() && (opts.filter?.(p) ?? true))
  for (const p of candidates) {
    const t0 = Date.now()
    try {
      const result = await run(p)
      attempts.push({ provider: p.id, ok: true, ms: Date.now() - t0 })
      if (p.id === 'openrouter') {
        fallbackAlert({
          agent: kind,
          primary: list[0]?.id ?? 'none',
          used: 'openrouter',
          reason:
            attempts.filter((a) => !a.ok).map((a) => `${a.provider}: ${a.error}`).join('; ') ||
            `${list[0]?.id} skipped (parked after an earlier failure or not configured)`,
        })
      }
      return { result, provider: p.id, attempts }
    } catch (err) {
      const msg = String((err as any)?.message ?? err).slice(0, 240)
      attempts.push({ provider: p.id, ok: false, error: msg, ms: Date.now() - t0 })
      logProviderError(kind, p.id, err)
      if (isPermanentError(err) || (err as any)?.permanent) park(p.id === 'bedrock-text' ? 'bedrock' : p.id, msg)
    }
  }
  const err = new Error(`${kind}: no provider succeeded (${attempts.map((a) => `${a.provider}: ${a.error}`).join(' | ') || 'none configured'})`)
  ;(err as any).attempts = attempts
  throw err
}

export const ttsFor = (lang: Language) => (p: TTSProvider) => p.supports(lang)
export const sttFor = (lang: Language) => (p: STTProvider) => p.supports(lang)
