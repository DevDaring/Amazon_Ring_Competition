import { z } from 'zod'

// Every env key is read here and nowhere else, so a missing key fails once,
// loudly, at startup instead of deep inside a webhook job.

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v)))

const ConfigSchema = z.object({
  // Ring
  RING_CLIENT_ID: z.string().min(1, 'RING_CLIENT_ID is required (Ring Developer Portal > App credentials)'),
  RING_CLIENT_SECRET: z.string().min(1, 'RING_CLIENT_SECRET is required'),
  RING_HMAC_KEY: z.string().min(1, 'RING_HMAC_KEY is required: webhooks cannot be verified without it'),
  RING_SANDBOX_TOKEN: z.string().optional().default(''),
  RING_REFRESH_TOKEN: z.string().optional().default(''),
  RING_API_BASE: z.string().url().default('https://api.amazonvision.com'),
  RING_OAUTH_BASE: z.string().url().default('https://oauth.ring.com'),

  // AWS
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_REGION: z.string().default('us-east-1'),
  BEDROCK_MODEL_FAST: z.string().default('amazon.nova-lite-v1:0'),
  BEDROCK_MODEL_STRONG: z.string().optional().default(''),
  BEDROCK_MODEL_JUDGE: z.string().default('amazon.nova-micro-v1:0'),
  BEDROCK_GUARDRAIL_ID: z.string().optional().default(''),
  BEDROCK_GUARDRAIL_VERSION: z.string().default('DRAFT'),
  POLLY_VOICE_EN: z.string().default('Joanna'),
  POLLY_VOICE_HI: z.string().default('Kajal'),
  POLLY_VOICE_ES: z.string().default('Lupe'),
  USE_REKOGNITION: bool(true),
  S3_BUCKET: z.string().optional().default(''),

  // Fallbacks (comma-separated keys rotate round-robin)
  OPENROUTER_API_KEY: csv,
  OPENROUTER_VISION_MODEL: z.string().default('google/gemini-2.5-flash'),
  OPENAI_API_KEY: csv,
  OPENAI_VISION_MODEL: z.string().default('gpt-4o-mini'),
  SARVAM_API_KEY: csv,
  SARVAM_SPEAKER: z.string().default('priya'),
  FISH_AUDIO_API_KEY: csv,
  DEEPSEEK_API_KEY: csv,

  // App
  APP_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_WEBHOOK_URL: z.string().optional().default(''),
  DEFAULT_LANGUAGE: z.enum(['en', 'hi', 'bn', 'es']).default('en'),
  DEMO_MODE: bool(true),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FALLBACK_ALERT_LOG: z.string().optional().default(''),
})

export type AppConfig = z.infer<typeof ConfigSchema>

let cached: AppConfig | null = null

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new ConfigError(
      `DoorVoice cannot start: .env is incomplete.\n${lines.join('\n')}\nCopy .env.example to .env and fill the keys.`
    )
  }
  return parsed.data
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig()
  return cached
}

/** Test hook: lets unit tests run with a fake config. */
export function setConfigForTests(partial: Partial<AppConfig>) {
  cached = { ...loadConfig({ RING_CLIENT_ID: 'x', RING_CLIENT_SECRET: 'x', RING_HMAC_KEY: 'test-key' } as any), ...partial }
}

export function hasAws(c = config()) {
  return Boolean(c.AWS_ACCESS_KEY_ID && c.AWS_SECRET_ACCESS_KEY)
}

/** Non-fatal warnings shown on the Settings screen and in the startup log. */
export function configWarnings(c = config()): string[] {
  const w: string[] = []
  if (!c.RING_SANDBOX_TOKEN && !c.RING_REFRESH_TOKEN)
    w.push('No Ring token: paste a Developer Playground token in Settings to list devices and stream.')
  if (!hasAws(c)) w.push('AWS keys missing: vision, detection and speech fall back to OpenRouter/Sarvam/browser.')
  if (!c.BEDROCK_MODEL_STRONG) w.push('BEDROCK_MODEL_STRONG empty: low-confidence events will not escalate.')
  if (!c.PUBLIC_WEBHOOK_URL) w.push('PUBLIC_WEBHOOK_URL empty: real Ring webhooks cannot reach this machine; use the Demo panel.')
  return w
}
