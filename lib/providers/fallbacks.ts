import sharp from 'sharp'
import { config } from '../config'
import { toWav16k } from '../pipeline/ffmpeg'
import type { Language } from '../pipeline/types'
import {
  ModelCall,
  ProviderError,
  STTProvider,
  TTSProvider,
  TextProvider,
  TextRequest,
  VisionProvider,
  VisionRequest,
} from './types'
import { extractJson, fetchWithTimeout, isParked, nextKey, tokenCost } from './util'

/** OpenRouter and OpenAI share the chat-completions wire format. */
class OpenAICompatible implements VisionProvider, TextProvider {
  constructor(
    public id: string,
    private baseUrl: string,
    private keys: () => string[],
    private model: () => string
  ) {}
  available() {
    return this.keys().length > 0 && !isParked(this.id)
  }
  private async chat(system: string, content: any[], maxTokens: number): Promise<ModelCall> {
    const t0 = Date.now()
    const model = this.model()
    const res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      timeoutMs: 30_000,
      headers: {
        Authorization: `Bearer ${nextKey(this.id, this.keys())}`,
        'Content-Type': 'application/json',
        'X-Title': 'DoorVoice',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
    })
    if (!res.ok) throw new ProviderError(this.id, `${res.status} ${(await res.text()).slice(0, 200)}`, [401, 402, 403].includes(res.status))
    const data = await res.json()
    const inTok = data.usage?.prompt_tokens ?? 0
    const outTok = data.usage?.completion_tokens ?? 0
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model,
      provider: this.id,
      inputTokens: inTok,
      outputTokens: outTok,
      latencyMs: Date.now() - t0,
      costUsd: data.usage?.cost ?? tokenCost(model, inTok, outTok),
    }
  }
  async describe(req: VisionRequest) {
    const images = await Promise.all(
      req.images.map(async (b) => ({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${(await sharp(b).resize({ width: 1280, height: 1280, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`,
        },
      }))
    )
    const call = await this.chat(req.system, [...images, { type: 'text', text: req.prompt }], req.maxTokens ?? 700)
    return { ...call, text: extractJson(call.text) }
  }
  complete(req: TextRequest) {
    return this.chat(req.system, [{ type: 'text', text: req.prompt }], req.maxTokens ?? 400)
  }
}

export const openRouter = () =>
  new OpenAICompatible('openrouter', 'https://openrouter.ai/api/v1', () => config().OPENROUTER_API_KEY, () => config().OPENROUTER_VISION_MODEL)
export const openAI = () =>
  new OpenAICompatible('openai', 'https://api.openai.com/v1', () => config().OPENAI_API_KEY, () => config().OPENAI_VISION_MODEL)

const SARVAM_LANG: Partial<Record<Language, string>> = { hi: 'hi-IN', bn: 'bn-IN', en: 'en-IN' }

/** Sarvam (bulbul:v3) is the only provider here with a natural Bengali voice. */
export class SarvamTTS implements TTSProvider {
  id = 'sarvam'
  available() {
    return config().SARVAM_API_KEY.length > 0 && !isParked(this.id)
  }
  supports(lang: Language) {
    return lang in SARVAM_LANG
  }
  async synthesize(text: string, lang: Language) {
    const t0 = Date.now()
    const res = await fetchWithTimeout('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      timeoutMs: 20_000,
      headers: { 'api-subscription-key': nextKey(this.id, config().SARVAM_API_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        target_language_code: SARVAM_LANG[lang],
        model: 'bulbul:v3',
        speaker: config().SARVAM_SPEAKER,
      }),
    })
    if (!res.ok) throw new ProviderError(this.id, `${res.status} ${(await res.text()).slice(0, 200)}`, [401, 403].includes(res.status))
    const data = await res.json()
    const audio = Buffer.from(data.audios?.[0] ?? '', 'base64')
    // Sarvam lists TTS at about INR 15 per 10,000 characters.
    return { audio, mime: 'audio/wav', voice: config().SARVAM_SPEAKER, provider: this.id, latencyMs: Date.now() - t0, costUsd: (text.length / 10_000) * 0.18 }
  }
}

export class SarvamSTT implements STTProvider {
  id = 'sarvam-stt'
  available() {
    return config().SARVAM_API_KEY.length > 0 && !isParked(this.id)
  }
  supports(lang: Language) {
    return lang in SARVAM_LANG
  }
  async transcribe(audio: Buffer, _mime: string, lang: Language) {
    const t0 = Date.now()
    const wav = await toWav16k(audio)
    const form = new FormData()
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'question.wav')
    form.append('model', 'saarika:v2.5')
    form.append('language_code', SARVAM_LANG[lang] ?? 'unknown')
    const res = await fetchWithTimeout('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      timeoutMs: 25_000,
      headers: { 'api-subscription-key': nextKey(this.id, config().SARVAM_API_KEY) },
      body: form,
    })
    if (!res.ok) throw new ProviderError(this.id, `${res.status} ${(await res.text()).slice(0, 200)}`, [401, 403].includes(res.status))
    const data = await res.json()
    return { text: (data.transcript ?? '').trim(), language: data.language_code, provider: this.id, latencyMs: Date.now() - t0 }
  }
}

/** Fish Audio covers Spanish (and English) when Polly is not available. */
export class FishTTS implements TTSProvider {
  id = 'fish-audio'
  available() {
    return config().FISH_AUDIO_API_KEY.length > 0 && !isParked(this.id)
  }
  supports(lang: Language) {
    return lang === 'es' || lang === 'en' || lang === 'hi'
  }
  async synthesize(text: string, _lang: Language) {
    const t0 = Date.now()
    const res = await fetchWithTimeout('https://api.fish.audio/v1/tts', {
      method: 'POST',
      timeoutMs: 25_000,
      headers: {
        Authorization: `Bearer ${nextKey(this.id, config().FISH_AUDIO_API_KEY)}`,
        'Content-Type': 'application/json',
        model: 's1',
      },
      body: JSON.stringify({ text, format: 'mp3' }),
    })
    if (!res.ok) throw new ProviderError(this.id, `${res.status} ${(await res.text()).slice(0, 200)}`, [401, 402, 403].includes(res.status))
    const audio = Buffer.from(await res.arrayBuffer())
    return { audio, mime: 'audio/mpeg', voice: 's1-default', provider: this.id, latencyMs: Date.now() - t0, costUsd: (text.length / 1e6) * 15 }
  }
}

export class OpenAISTT implements STTProvider {
  id = 'openai-stt'
  available() {
    return config().OPENAI_API_KEY.length > 0 && !isParked(this.id)
  }
  supports() {
    return true
  }
  async transcribe(audio: Buffer, _mime: string, lang: Language) {
    const t0 = Date.now()
    const form = new FormData()
    form.append('file', new Blob([await toWav16k(audio)], { type: 'audio/wav' }), 'q.wav')
    form.append('model', 'whisper-1')
    form.append('language', lang)
    const res = await fetchWithTimeout('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${nextKey(this.id, config().OPENAI_API_KEY)}` },
      body: form,
    })
    if (!res.ok) throw new ProviderError(this.id, `${res.status}`, [401, 403].includes(res.status))
    const data = await res.json()
    return { text: data.text ?? '', language: lang, provider: this.id, latencyMs: Date.now() - t0 }
  }
}
