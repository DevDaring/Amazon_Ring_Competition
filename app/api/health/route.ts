import { NextResponse } from 'next/server'
import { config, configWarnings, hasAws } from '@/lib/config'
import { parkedProviders } from '@/lib/providers/util'
import { authStatus } from '@/lib/ring/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What is configured and what has failed recently. No secrets, only booleans and model IDs. */
export async function GET() {
  const c = config()
  return NextResponse.json({
    demoMode: c.DEMO_MODE,
    ring: authStatus(),
    aws: { configured: hasAws(), region: c.AWS_REGION, fast: c.BEDROCK_MODEL_FAST, strong: c.BEDROCK_MODEL_STRONG || null, judge: c.BEDROCK_MODEL_JUDGE, guardrailId: Boolean(c.BEDROCK_GUARDRAIL_ID), rekognition: c.USE_REKOGNITION },
    fallbacks: {
      openrouter: c.OPENROUTER_API_KEY.length > 0,
      openai: c.OPENAI_API_KEY.length > 0,
      sarvam: c.SARVAM_API_KEY.length > 0,
      fishAudio: c.FISH_AUDIO_API_KEY.length > 0,
    },
    parked: parkedProviders(),
    warnings: configWarnings(),
    webhookUrl: c.PUBLIC_WEBHOOK_URL || `${c.APP_BASE_URL}/api/ring/webhook`,
  })
}
