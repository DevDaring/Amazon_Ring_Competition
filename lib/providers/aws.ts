import {
  ApplyGuardrailCommand,
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  Message,
} from '@aws-sdk/client-bedrock-runtime'
import { DetectLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition'
import { PollyClient, SynthesizeSpeechCommand, VoiceId, LanguageCode as PollyLang } from '@aws-sdk/client-polly'
import {
  LanguageCode,
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
} from '@aws-sdk/client-transcribe-streaming'
import sharp from 'sharp'
import { config, hasAws } from '../config'
import { toPcm16k } from '../pipeline/ffmpeg'
import type { Detection, Language, Stage1Result } from '../pipeline/types'
import {
  JudgmentChecker,
  ModelCall,
  ObjectDetector,
  STTProvider,
  TTSProvider,
  TextProvider,
  TextRequest,
  VisionProvider,
  VisionRequest,
} from './types'
import { extractJson, isParked, isPermanentError, park, tokenCost } from './util'

const creds = () => {
  const c = config()
  return {
    region: c.AWS_REGION,
    credentials: { accessKeyId: c.AWS_ACCESS_KEY_ID, secretAccessKey: c.AWS_SECRET_ACCESS_KEY },
  }
}

let bedrock: BedrockRuntimeClient | null = null
const bedrockClient = () => (bedrock ??= new BedrockRuntimeClient(creds()))

/** Bedrock Converse works the same for Nova and Claude, so one call site serves both tiers. */
async function converse(modelId: string, system: string, content: ContentBlock[], maxTokens: number, prefill?: string): Promise<ModelCall> {
  const messages: Message[] = [{ role: 'user', content }]
  // Pre-filling "{" keeps both Nova and Claude from wrapping the JSON in prose.
  if (prefill) messages.push({ role: 'assistant', content: [{ text: prefill }] })
  const t0 = Date.now()
  const out = await bedrockClient().send(
    new ConverseCommand({
      modelId,
      system: [{ text: system }],
      messages,
      inferenceConfig: { maxTokens, temperature: 0 },
    })
  )
  const text = (prefill ?? '') + (out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '')
  const inTok = out.usage?.inputTokens ?? 0
  const outTok = out.usage?.outputTokens ?? 0
  return {
    text,
    model: modelId,
    provider: 'bedrock',
    inputTokens: inTok,
    outputTokens: outTok,
    latencyMs: Date.now() - t0,
    costUsd: tokenCost(modelId, inTok, outTok),
  }
}

async function jpegBlocks(images: Buffer[], maxSide = 1280): Promise<ContentBlock[]> {
  return Promise.all(
    images.map(async (img) => ({
      image: {
        format: 'jpeg' as const,
        source: { bytes: await sharp(img).resize({ width: maxSide, height: maxSide, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer() },
      },
    }))
  )
}

export class BedrockVision implements VisionProvider {
  id = 'bedrock'
  available() {
    return hasAws() && !isParked(this.id)
  }
  async describe(req: VisionRequest) {
    const c = config()
    const strong = req.tier === 'strong' && c.BEDROCK_MODEL_STRONG && !isParked(`bedrock:${c.BEDROCK_MODEL_STRONG}`)
    const model = strong ? c.BEDROCK_MODEL_STRONG : c.BEDROCK_MODEL_FAST
    const content = [...(await jpegBlocks(req.images)), { text: req.prompt }]
    try {
      const call = await converse(model, req.system, content, req.maxTokens ?? 700, '{')
      return { ...call, text: extractJson(call.text) }
    } catch (e) {
      // A strong model can be denied on its own (e.g. a Marketplace subscription without a
      // payment method) while Nova still works. Park only that model and answer with the
      // fast one, rather than letting the whole of Bedrock fall over to another provider.
      if (strong && isPermanentError(e)) {
        park(`bedrock:${model}`, String((e as Error).message).slice(0, 200), 60 * 60_000)
        const call = await converse(c.BEDROCK_MODEL_FAST, req.system, content, req.maxTokens ?? 700, '{')
        return { ...call, text: extractJson(call.text), model: `${call.model} (strong model unavailable)` }
      }
      throw e
    }
  }
}

export class BedrockText implements TextProvider {
  id = 'bedrock-text'
  available() {
    return hasAws() && !isParked('bedrock')
  }
  complete(req: TextRequest) {
    return converse(config().BEDROCK_MODEL_FAST, req.system, [{ text: req.prompt }], req.maxTokens ?? 400)
  }
}

/**
 * Guardrail layer 3. Uses Bedrock Guardrails when an ID is configured, otherwise a
 * strict YES/NO classifier prompt on Nova Micro (the cheapest text model).
 */
export class BedrockJudgment implements JudgmentChecker {
  id = config().BEDROCK_GUARDRAIL_ID ? 'bedrock-guardrails' : 'nova-micro-classifier'
  available() {
    return hasAws() && !isParked('bedrock')
  }
  async check(text: string) {
    const c = config()
    const t0 = Date.now()
    if (c.BEDROCK_GUARDRAIL_ID) {
      const out = await bedrockClient().send(
        new ApplyGuardrailCommand({
          guardrailIdentifier: c.BEDROCK_GUARDRAIL_ID,
          guardrailVersion: c.BEDROCK_GUARDRAIL_VERSION,
          source: 'OUTPUT',
          content: [{ text: { text } }],
        })
      )
      const flagged = out.action === 'GUARDRAIL_INTERVENED'
      return {
        flagged,
        reason: flagged ? JSON.stringify(out.assessments?.[0] ?? {}).slice(0, 200) : undefined,
        latencyMs: Date.now() - t0,
        costUsd: 0.00015,
      }
    }
    const call = await converse(
      c.BEDROCK_MODEL_JUDGE,
      'You are a strict content-safety classifier for a doorbell narration app. Reply with exactly one word: YES or NO.',
      [
        {
          text:
            'Does the following camera description do ANY of these: name or identify a person; guess race, ethnicity, ' +
            'gender, age beyond child/adult, religion, disability or body type; judge intent or character ' +
            '(e.g. suspicious, threatening, lurking); or use insulting or toxic language? ' +
            'Describing clothing colour, carried items, vehicles, positions and actions is fine.\n\n' +
            `DESCRIPTION:\n${text}\n\nAnswer YES or NO:`,
        },
      ],
      3
    )
    const flagged = /^\s*yes/i.test(call.text)
    return { flagged, reason: flagged ? 'classifier answered YES' : undefined, latencyMs: call.latencyMs, costUsd: call.costUsd }
  }
}

const LABEL_MAP: Array<[RegExp, Detection['category']]> = [
  [/^(person|human|people|adult|child|man|woman|boy|girl|pedestrian)$/i, 'person'],
  [/^(package|box|cardboard|carton|parcel|envelope|mail|bag|shopping bag|grocery)$/i, 'package'],
  [/^(car|vehicle|van|truck|automobile|suv|bus|motorcycle|bicycle|bike|transportation|pickup truck|moving van)$/i, 'vehicle'],
  [/^(dog|cat|animal|pet|bird|mammal|canine|puppy|kitten)$/i, 'animal'],
]

/** Stage 1 gate on Rekognition DetectLabels: about $0.001 per image. */
export class RekognitionDetector implements ObjectDetector {
  id = 'rekognition'
  private client: RekognitionClient | null = null
  available() {
    return hasAws() && config().USE_REKOGNITION && !isParked(this.id)
  }
  async detect(image: Buffer) {
    const t0 = Date.now()
    this.client ??= new RekognitionClient(creds())
    const small = await sharp(image).resize({ width: 1280, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
    const out = await this.client.send(
      // 40, not 55: on the sandbox's high, compressed 720p view Rekognition rated a car park full of cars 'Vehicle 44.6%'.
      new DetectLabelsCommand({ Image: { Bytes: small }, MaxLabels: 40, MinConfidence: 40 })
    )
    const detections: Detection[] = []
    const score = { person: 0, package: 0, vehicle: 0, animal: 0 }
    for (const label of out.Labels ?? []) {
      const cat = LABEL_MAP.find(([re]) => re.test(label.Name ?? ''))?.[1]
      if (!cat || cat === 'other') continue
      const conf = (label.Confidence ?? 0) / 100
      score[cat] = Math.max(score[cat], conf)
      const instances = label.Instances?.length ? label.Instances : [{ BoundingBox: undefined, Confidence: label.Confidence }]
      for (const inst of instances) {
        const b = inst.BoundingBox
        detections.push({
          label: label.Name ?? cat,
          category: cat,
          confidence: (inst.Confidence ?? label.Confidence ?? 0) / 100,
          box: b ? { left: b.Left ?? 0, top: b.Top ?? 0, width: b.Width ?? 0, height: b.Height ?? 0 } : undefined,
        })
      }
    }
    const result: Stage1Result = {
      ...score,
      detections,
      empty: Object.values(score).every((s) => s < 0.4),
      provider: this.id,
    }
    return { ...result, latencyMs: Date.now() - t0, costUsd: 0.001 }
  }
}

/**
 * Stage 1 fallback when Rekognition is not permitted: Nova Lite with a tiny prompt
 * on a downscaled frame. Still cheap (about $0.0001), slower than Rekognition.
 */
export class NovaDetector implements ObjectDetector {
  id = 'nova-lite-detector'
  available() {
    return hasAws() && !isParked('bedrock')
  }
  async detect(image: Buffer) {
    // Counts, not probabilities: in testing Nova Lite answered "vehicle": 4 when asked for a 0-1 score.
    const content = [
      ...(await jpegBlocks([image], 640)),
      {
        text:
          'Count what is visible in this camera frame. Ignore the watermark text in the corners and any timestamp bar. ' +
          'Reply with JSON only, integers: {"people":N,"parcels_or_bags":N,"vehicles":N,"animals":N,' +
          '"people_x":[horizontal centre of each person as a fraction 0-1 of the frame width]}',
      },
    ]
    const call = await converse(config().BEDROCK_MODEL_FAST, 'You count objects in images. Output JSON only.', content, 120, '{')
    let parsed: any = {}
    try {
      parsed = JSON.parse(extractJson(call.text))
    } catch {
      parsed = {}
    }
    const count = (v: unknown) => (typeof v === 'number' && v >= 0 ? Math.min(Math.round(v), 30) : 0)
    // A model count is not a calibrated probability; any sighting counts as 0.85.
    const score = (n: number) => (n > 0 ? 0.85 : 0)
    const n = { person: count(parsed.people), package: count(parsed.parcels_or_bags), vehicle: count(parsed.vehicles), animal: count(parsed.animals) }
    const xs: number[] = Array.isArray(parsed.people_x) ? parsed.people_x.filter((x: unknown) => typeof x === 'number' && x >= 0 && x <= 1) : []
    const detections: Detection[] = [
      ...Array.from({ length: n.person }, (_, i) => ({
        label: 'person',
        category: 'person' as const,
        confidence: 0.85,
        box: xs[i] !== undefined ? { left: Math.max(0, xs[i] - 0.05), top: 0, width: 0.1, height: 1 } : undefined,
      })),
      ...Array.from({ length: n.vehicle }, () => ({ label: 'vehicle', category: 'vehicle' as const, confidence: 0.85 })),
      ...Array.from({ length: n.package }, () => ({ label: 'package', category: 'package' as const, confidence: 0.85 })),
      ...Array.from({ length: n.animal }, () => ({ label: 'animal', category: 'animal' as const, confidence: 0.85 })),
    ]
    const result: Stage1Result = {
      person: score(n.person),
      package: score(n.package),
      vehicle: score(n.vehicle),
      animal: score(n.animal),
      detections,
      empty: Object.values(n).every((v) => v === 0),
      provider: this.id,
    }
    return { ...result, latencyMs: call.latencyMs, costUsd: call.costUsd }
  }
}

const POLLY_VOICES: Partial<Record<Language, { voice: () => string; lang?: PollyLang }>> = {
  en: { voice: () => config().POLLY_VOICE_EN },
  hi: { voice: () => config().POLLY_VOICE_HI, lang: 'hi-IN' },
  es: { voice: () => config().POLLY_VOICE_ES },
}

export class PollyTTS implements TTSProvider {
  id = 'polly'
  private client: PollyClient | null = null
  available() {
    return hasAws() && !isParked(this.id)
  }
  supports(lang: Language) {
    return lang in POLLY_VOICES // Polly has no Bengali voice
  }
  async synthesize(text: string, lang: Language) {
    const t0 = Date.now()
    this.client ??= new PollyClient(creds())
    const v = POLLY_VOICES[lang]!
    const out = await this.client.send(
      new SynthesizeSpeechCommand({
        Engine: 'neural',
        OutputFormat: 'mp3',
        Text: text,
        VoiceId: v.voice() as VoiceId,
        LanguageCode: v.lang,
      })
    )
    const audio = Buffer.from(await out.AudioStream!.transformToByteArray())
    return { audio, mime: 'audio/mpeg', voice: v.voice(), provider: this.id, latencyMs: Date.now() - t0, costUsd: (text.length * 16) / 1e6 }
  }
}

const TRANSCRIBE_LANGS: Partial<Record<Language, LanguageCode>> = { en: 'en-US', hi: 'hi-IN', es: 'es-US' }

/** Amazon Transcribe streaming. The browser records webm/opus; ffmpeg turns it into PCM. */
export class TranscribeSTT implements STTProvider {
  id = 'transcribe'
  private client: TranscribeStreamingClient | null = null
  available() {
    return hasAws() && !isParked(this.id)
  }
  supports(lang: Language) {
    return lang in TRANSCRIBE_LANGS
  }
  async transcribe(audio: Buffer, _mime: string, lang: Language) {
    const t0 = Date.now()
    this.client ??= new TranscribeStreamingClient(creds())
    const pcm = await toPcm16k(audio)
    async function* chunks() {
      for (let i = 0; i < pcm.length; i += 8192) yield { AudioEvent: { AudioChunk: pcm.subarray(i, i + 8192) } }
    }
    const resp = await this.client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: TRANSCRIBE_LANGS[lang],
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: 16000,
        AudioStream: chunks(),
      })
    )
    const parts: string[] = []
    for await (const ev of resp.TranscriptResultStream ?? []) {
      for (const r of ev.TranscriptEvent?.Transcript?.Results ?? []) {
        if (!r.IsPartial && r.Alternatives?.[0]?.Transcript) parts.push(r.Alternatives[0].Transcript)
      }
    }
    return { text: parts.join(' ').trim(), language: lang, provider: this.id, latencyMs: Date.now() - t0 }
  }
}
