import { z } from 'zod'

// The vision model may only speak in this vocabulary. Closed enums are the first
// line of the safety layer: there is no field in which a model could write
// "suspicious" or a skin colour and have it reach the composer unchecked.

export const POSITIONS = ['left', 'centre', 'right'] as const
export const DISTANCES = ['near', 'far'] as const
export const MOTIONS = ['toward', 'away', 'still', 'passing', 'unknown'] as const
export const AGE_GROUPS = ['adult', 'child', 'unknown'] as const
export const COLOURS = [
  'black', 'white', 'grey', 'silver', 'red', 'orange', 'yellow', 'green',
  'blue', 'purple', 'pink', 'brown', 'beige', 'unknown',
] as const
export const OBJECT_TYPES = [
  'parcel', 'flat_parcel', 'bag', 'grocery_bag', 'food_delivery', 'envelope', 'flowers',
  'umbrella', 'bicycle', 'scooter', 'pram', 'trolley', 'tool', 'ladder', 'bin', 'sign', 'other',
] as const
export const VEHICLE_TYPES = ['car', 'van', 'truck', 'motorcycle', 'bicycle', 'bus', 'suv', 'other'] as const
export const ANIMAL_TYPES = ['dog', 'cat', 'bird', 'other'] as const

const pos = z.enum(POSITIONS).catch('centre')
const dist = z.enum(DISTANCES).catch('near')
const motion = z.enum(MOTIONS).catch('unknown')
const colour = z.enum(COLOURS).catch('unknown')

export const PersonSchema = z.object({
  age_group: z.enum(AGE_GROUPS).catch('unknown'),
  position: pos,
  distance: dist,
  motion,
  carrying: z.array(z.enum(OBJECT_TYPES).catch('other')).max(4).default([]),
  clothing_colour: colour.optional(),
  clothing: z.string().max(60).optional(),
})

export const ObjectSchema = z.object({
  type: z.enum(OBJECT_TYPES).catch('other'),
  label: z.string().max(40).optional(),
  position: pos,
  distance: dist,
})

export const VehicleSchema = z.object({
  type: z.enum(VEHICLE_TYPES).catch('other'),
  colour,
  position: pos,
  distance: dist,
  motion,
})

export const AnimalSchema = z.object({
  type: z.enum(ANIMAL_TYPES).catch('other'),
  position: pos,
})

export const StructuredDescriptionSchema = z
  .object({
    people: z.array(PersonSchema).max(12).default([]),
    objects: z.array(ObjectSchema).max(12).default([]),
    vehicles: z.array(VehicleSchema).max(12).default([]),
    animals: z.array(AnimalSchema).max(6).default([]),
    scene: z
      .object({
        lighting: z.enum(['day', 'night', 'dim']).catch('day'),
        setting: z.string().max(40).optional(),
        summary: z.string().max(160).optional(),
      })
      .default({ lighting: 'day' }),
    text_seen: z.array(z.string().max(80)).max(6).default([]),
    answer: z.string().max(300).optional(),
    confidence: z.number().min(0).max(1),
  })
  .strict()

export type StructuredDescription = z.infer<typeof StructuredDescriptionSchema>
export type Person = z.infer<typeof PersonSchema>
export type Language = 'en' | 'hi' | 'bn' | 'es'
export const LANGUAGES: Language[] = ['en', 'hi', 'bn', 'es']

export type StageName =
  | 'stage0' | 'frames' | 'stage1' | 'stage2' | 'stage3' | 'guardrails' | 'narration' | 'speech'

export interface StageMetric {
  stage: StageName
  status: 'passed' | 'stopped' | 'skipped' | 'fired' | 'error'
  latency_ms: number
  model_used?: string
  confidence?: number
  cost_estimate?: number
  note?: string
}

export interface Frame {
  buf: Buffer
  source: 'ring_snapshot' | 'ring_clip' | 'live_view' | 'simulated_upload' | 'sandbox_fixture'
  label: string
  capturedAt: number
  sharpness?: number
  brightness?: number
  width?: number
  height?: number
}

export interface Detection {
  label: string
  category: 'person' | 'package' | 'vehicle' | 'animal' | 'other'
  confidence: number
  box?: { left: number; top: number; width: number; height: number } // normalised 0-1
}

export interface Stage1Result {
  person: number
  package: number
  vehicle: number
  animal: number
  detections: Detection[]
  empty: boolean
  provider: string
}
