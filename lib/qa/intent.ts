// A cheap classifier so that "is anyone still there?" never costs a vision-model call,
// and identity questions are refused before any model sees them.

export type Intent = 'identity' | 'presence' | 'vehicle_presence' | 'read' | 'spatial' | 'describe' | 'other'

const RULES: Array<[Intent, RegExp]> = [
  [
    'identity',
    /\b(who(?:'s| is| are)\b|who\s+(?:it|that|this)|is (?:that|it|this|he|she) (?:my|our|the)\b|do i know|recogni[sz]e|their name|his name|her name|which (?:neighbou?r|friend)|is it (?:my|our)\b)|कौन\s*(?:है|हैं|था)|किसका|पहचान|(?<![ঀ-৿])কে(?![ঀ-৿])|চিনি|চেনা|quién|reconoces|conozco/i,
  ],
  [
    'vehicle_presence',
    /\b(van|car|truck|lorry|vehicle|bike|motorbike|suv)\b.*\b(still|there|gone|left|leave)\b|\b(still|gone)\b.*\b(van|car|truck|vehicle)\b|(गाड़ी|कार|वैन).*(अभी|गई|है)|(গাড়ি|ভ্যান).*(এখনও|গেছে|আছে)|(furgoneta|coche|camión|vehículo).*(sigue|todavía|se fue)/i,
  ],
  [
    'presence',
    /\b(still (?:there|here|at the door)|anyone|anybody|someone|somebody|did (?:they|he|she|the person) (?:go|leave)|have they (?:gone|left)|are they (?:still )?there|is (?:the person|it) gone|left yet)\b|कोई\s*है|अभी भी|चला गया|চলে গেছে|কেউ\s*আছে|এখনও আছে|sigue ahí|todavía hay|se fue|alguien/i,
  ],
  [
    'read',
    /\b(read|what does (?:it|the \w+) say|label|sign|written|writing|text|logo|says)\b|पढ़|लिखा|পড়|লেখা|\blee\b|leer|dice|etiqueta|cartel|letrero/i,
  ],
  [
    'spatial',
    /\b(holding|carrying|in (?:their|his|her) hands?|where(?:'s| is| are)|box|parcel|package|bag|delivery|left it|on the (?:ground|step|porch))\b|हाथ में|कहाँ|पार्सल|থায়|হাতে|পার্সেল|dónde|lleva|sostiene|paquete/i,
  ],
  [
    'describe',
    /\b(describe|everything|what(?:'s| is) (?:there|happening|going on|at the door)|what do you see|tell me more|more detail)\b|सब कुछ|क्या (?:है|हो रहा)|वर्णन|বর্ণনা|সব কিছু|কী (?:আছে|হচ্ছে)|describe|todo|qué (?:hay|pasa|ves)/i,
  ],
]

export function classifyQuestion(question: string): Intent {
  const q = question.trim()
  for (const [intent, re] of RULES) if (re.test(q)) return intent
  return 'other'
}

/** Which pipeline stages each intent needs. Shown in the Why panel. */
export const INTENT_ROUTE: Record<Intent, string> = {
  identity: 'refused before any model call; facts from the latest guarded description',
  presence: 'Stage 1 only (object gate on a fresh frame)',
  vehicle_presence: 'Stage 1 only (object gate on a fresh frame)',
  read: 'Stage 3 strong model, OCR prompt, names/addresses/IDs withheld',
  spatial: 'Stage 3 strong model, spatial prompt',
  describe: 'Stage 3 strong model, full description (max 60 words)',
  other: 'Stage 3 strong model, general prompt',
}
