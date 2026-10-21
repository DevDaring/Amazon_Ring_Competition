import { config } from '../config'
import { providers, withFallback, Attempt } from '../providers/registry'
import type { ModelCall } from '../providers/types'
import { ANIMAL_TYPES, COLOURS, OBJECT_TYPES, VEHICLE_TYPES } from './types'

export type Stage3Intent = 'narrate' | 'spatial' | 'read' | 'describe'

export const SYSTEM_PROMPT = `You describe a Ring doorbell camera frame for a blind or low-vision person.
You output ONE JSON object and nothing else. No prose, no markdown.

Hard rules (a safety layer checks every field and discards your output if you break them):
- Never identify anyone. No names, no relationships ("neighbour", "sister"), no "familiar" or "stranger".
- Never state or guess race, ethnicity, skin colour, gender, age beyond child/adult, religion, disability, body shape or attractiveness.
- Never judge intent or character. Do not use words like suspicious, lurking, threatening, casing, loitering.
- Never read licence plates, personal names, house numbers or ID numbers.
- Describe only: how many people, child or adult, where they are, what they are doing, what they carry, clothing colour; parcels and objects; vehicles (type, colour, position, motion); animals.
- Positions are from the camera's view: "left", "centre", "right" of the frame; "near" = at the door/porch, "far" = street or beyond.
- Ignore the Ring logo, the Device-ID/Partner/Generated-At text in the top-right corner, and any timestamp bar. They are watermarks, not scene content.
- List every visible vehicle and person as its own array item, including parked ones far away.
- Motion: with a single frame, use "still" for parked vehicles and standing people, and "unknown" when you cannot tell. Only use "toward", "away" or "passing" when several frames show the movement or there is clear motion blur.
- If unsure, lower "confidence" rather than guessing.

JSON schema (use only these keys and values):
{
  "people": [{"age_group":"adult|child|unknown","position":"left|centre|right","distance":"near|far","motion":"toward|away|still|passing|unknown","carrying":[${OBJECT_TYPES.map((t) => `"${t}"`).join('|')}],"clothing_colour":"${COLOURS.join('|')}","clothing":"<= 6 words, garments and colours only"}],
  "objects": [{"type":"${OBJECT_TYPES.join('|')}","label":"<= 4 words","position":"left|centre|right","distance":"near|far"}],
  "vehicles": [{"type":"${VEHICLE_TYPES.join('|')}","colour":"${COLOURS.join('|')}","position":"left|centre|right","distance":"near|far","motion":"toward|away|still|passing|unknown"}],
  "animals": [{"type":"${ANIMAL_TYPES.join('|')}","position":"left|centre|right"}],
  "scene": {"lighting":"day|night|dim","setting":"<= 4 words, e.g. porch, driveway, car park","summary":"<= 20 neutral words"},
  "text_seen": ["only when asked to read; short strings"],
  "answer": "only when a question is asked: <= 40 neutral words",
  "confidence": 0.0-1.0
}
Omit empty optional strings. Use [] for none.`

export function userPrompt(intent: Stage3Intent, opts: { eventType?: string; question?: string; frames: number }): string {
  const frames = opts.frames > 1 ? `You get ${opts.frames} frames from the same moment, oldest first. Use the motion between them.` : 'You get one frame.'
  switch (intent) {
    case 'narrate':
      return `${frames} Event: ${opts.eventType ?? 'motion'}. Describe who and what is at the door right now. Leave "answer" and "text_seen" empty.`
    case 'spatial':
      return `${frames} The user asks: "${opts.question}". Answer in "answer" with positions (left/centre/right, near/far) and what is being held or where objects are. Also fill the arrays.`
    case 'read':
      return `${frames} The user asks: "${opts.question}". Put any printed text on parcels, signs or vehicles into "text_seen" (max 6 short strings). Skip anything that is a personal name, a home address, a phone number, an ID or a licence plate. Summarise in "answer".`
    case 'describe':
      return `${frames} The user asks for a full description. Fill every array carefully and give a neutral "scene.summary" of up to 20 words.`
  }
}

export interface Stage3Result {
  raw: string
  call: ModelCall
  escalated: boolean
  attempts: Attempt[]
  totalCost: number
}

function readConfidence(raw: string): number | null {
  try {
    const c = JSON.parse(raw).confidence
    return typeof c === 'number' ? c : null
  } catch {
    return null
  }
}

/**
 * Fast model first. Escalate to the strong model only when the fast answer is
 * unparseable or unsure, or when a user asked a question (forceStrong).
 */
export async function runStage3(images: Buffer[], intent: Stage3Intent, opts: { eventType?: string; question?: string; forceStrong?: boolean }): Promise<Stage3Result> {
  const prompt = userPrompt(intent, { ...opts, frames: images.length })
  const v = providers().vision
  const strongAvailable = Boolean(config().BEDROCK_MODEL_STRONG)
  const tier = opts.forceStrong && strongAvailable ? 'strong' : 'fast'
  const first = await withFallback('stage3-vision', v, (p) => p.describe({ images, system: SYSTEM_PROMPT, prompt, tier }))
  let attempts = first.attempts
  let call = first.result
  let totalCost = call.costUsd
  let escalated = tier === 'strong'
  const conf = readConfidence(call.text)
  // Below 0.5 the composer could only say "I can't tell"; 0.5-0.8 is spoken with "looks like",
  // so escalating there would add ~8 s (measured with Nova Pro on 3 frames) for little gain.
  if (tier === 'fast' && strongAvailable && (conf === null || conf < 0.5)) {
    try {
      const second = await withFallback('stage3-vision-strong', v, (p) => p.describe({ images, system: SYSTEM_PROMPT, prompt, tier: 'strong' }))
      attempts = attempts.concat(second.attempts)
      call = second.result
      totalCost += call.costUsd
      escalated = true
    } catch (e) {
      attempts = attempts.concat((e as any).attempts ?? [])
    }
  }
  return { raw: call.text, call, escalated, attempts, totalCost }
}
