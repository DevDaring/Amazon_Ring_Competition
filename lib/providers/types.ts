import type { Language, Stage1Result } from '../pipeline/types'

// The pipeline only sees these interfaces. Which company answered is recorded
// in the result for the "Why did it say that?" panel, never branched on.

export interface ModelCall {
  text: string
  model: string
  provider: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  costUsd: number
}

export interface VisionRequest {
  images: Buffer[]
  system: string
  prompt: string
  maxTokens?: number
  /** Ask for the strong tier instead of the fast one. */
  tier?: 'fast' | 'strong'
}

export interface VisionProvider {
  id: string
  available(): boolean
  describe(req: VisionRequest): Promise<ModelCall>
}

export interface TextRequest {
  system: string
  prompt: string
  maxTokens?: number
}

export interface TextProvider {
  id: string
  available(): boolean
  complete(req: TextRequest): Promise<ModelCall>
}

export interface SpeechResult {
  audio: Buffer
  mime: string
  voice: string
  provider: string
  latencyMs: number
  costUsd: number
}

export interface TTSProvider {
  id: string
  available(): boolean
  supports(lang: Language): boolean
  synthesize(text: string, lang: Language): Promise<SpeechResult>
}

export interface Transcript {
  text: string
  language?: string
  provider: string
  latencyMs: number
}

export interface STTProvider {
  id: string
  available(): boolean
  supports(lang: Language): boolean
  transcribe(audio: Buffer, mime: string, lang: Language): Promise<Transcript>
}

export interface ObjectDetector {
  id: string
  available(): boolean
  detect(image: Buffer): Promise<Stage1Result & { latencyMs: number; costUsd: number }>
}

export interface JudgmentChecker {
  id: string
  available(): boolean
  check(text: string): Promise<{ flagged: boolean; reason?: string; latencyMs: number; costUsd: number }>
}

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public permanent = false) {
    super(`${provider}: ${message}`)
  }
}
