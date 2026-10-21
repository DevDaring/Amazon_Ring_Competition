// Deterministic block lists for guardrail layer 2. Kept as data so SAFETY.md and
// the tests can point at one place. Matching is whole-word and case-insensitive.

export type ForbiddenCategory =
  | 'race_ethnicity'
  | 'gender'
  | 'age'
  | 'religion'
  | 'disability'
  | 'body'
  | 'intent'
  | 'identity'
  | 'personal_name'
  | 'plate_or_id'
  | 'address'

/** Categories that mean the model made a judgment; the whole output is distrusted. */
export const FIRE_CATEGORIES: ForbiddenCategory[] = ['intent', 'identity', 'personal_name']

const PERSON_NOUNS = '(?:man|men|woman|women|guy|guys|gal|person|people|male|female|boy|girl|lady|ladies|gentleman|kid|individual|visitor|figure|skin|skinned|complexion)'

export const WORD_LISTS: Record<Exclude<ForbiddenCategory, 'personal_name' | 'plate_or_id' | 'address'>, string[]> = {
  race_ethnicity: [
    'asian', 'african', 'african-american', 'caucasian', 'hispanic', 'latino', 'latina', 'latinx',
    'arab', 'arabic', 'middle eastern', 'indian', 'south asian', 'east asian', 'chinese', 'japanese',
    'korean', 'mexican', 'european', 'native american', 'indigenous', 'aboriginal', 'ethnic', 'ethnicity',
    'race', 'racial', 'mixed-race', 'biracial', 'dark-skinned', 'light-skinned', 'fair-skinned',
    'olive-skinned', 'skin tone', 'complexion',
  ],
  gender: [
    'man', 'men', 'woman', 'women', 'male', 'female', 'boy', 'boys', 'girl', 'girls', 'guy', 'guys',
    'gal', 'lady', 'ladies', 'gentleman', 'gentlemen', 'he', 'she', 'him', 'her', 'his', 'hers',
    'himself', 'herself', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'masculine', 'feminine',
    'transgender', 'nonbinary', 'non-binary', 'gender',
  ],
  age: [
    'elderly', 'old', 'older', 'senior citizen', 'aged', 'teen', 'teenager', 'teenage', 'adolescent',
    'young', 'youth', 'middle-aged', 'toddler', 'baby', 'infant', 'twenties', 'thirties', 'forties',
    'fifties', 'sixties', 'seventies', 'grey-haired', 'gray-haired', 'wrinkled',
  ],
  religion: [
    'muslim', 'islamic', 'christian', 'hindu', 'sikh', 'jewish', 'buddhist', 'religious', 'hijab',
    'niqab', 'burqa', 'burka', 'turban', 'kippah', 'yarmulke', 'bindi', 'crucifix', 'nun', 'priest',
    'monk', 'rosary', 'tilak',
  ],
  disability: [
    'wheelchair', 'disabled', 'disability', 'handicapped', 'blind', 'deaf', 'limp', 'limping',
    'crutches', 'crutch', 'walking cane', 'prosthetic', 'amputee', 'paralysed', 'paralyzed',
    'hearing aid', 'mobility aid',
  ],
  body: [
    'fat', 'obese', 'overweight', 'chubby', 'thin', 'skinny', 'slim', 'muscular', 'heavyset',
    'heavy-set', 'stocky', 'petite', 'bald', 'balding', 'beard', 'bearded', 'moustache', 'mustache',
    'tattoo', 'tattoos', 'tattooed', 'pregnant', 'attractive', 'ugly', 'pretty', 'handsome',
    'beautiful', 'blonde', 'blond', 'brunette', 'redhead', 'hairstyle', 'dreadlocks', 'afro', 'braids',
    'skin', 'curvy', 'tall', 'short',
  ],
  intent: [
    'suspicious', 'suspiciously', 'lurking', 'lurks', 'threatening', 'threat', 'casing', 'loitering',
    'loiterer', 'prowling', 'prowler', 'sneaking', 'sneaky', 'stalking', 'stalker', 'burglar',
    'burglary', 'thief', 'theft', 'stealing', 'steal', 'criminal', 'crime', 'intruder', 'trespasser',
    'trespassing', 'dangerous', 'aggressive', 'menacing', 'shady', 'sketchy', 'creepy', 'nervous',
    'angry', 'hostile', 'porch pirate', 'gang', 'gang member', 'illegal', 'drunk', 'intoxicated',
    'up to no good', 'breaking in', 'break in', 'casing the', 'scoping', 'malicious', 'dodgy',
    'questionable', 'unsavory', 'unsavoury', 'thug', 'vandal', 'looks like trouble',
  ],
  identity: [
    'neighbour', 'neighbor', 'neighbours', 'neighbors', 'sister', 'brother', 'mother', 'father', 'mom',
    'mum', 'dad', 'husband', 'wife', 'son', 'daughter', 'grandma', 'grandpa', 'grandmother',
    'grandfather', 'aunt', 'uncle', 'cousin', 'friend', 'boyfriend', 'girlfriend', 'stranger',
    'familiar', 'recognise', 'recognize', 'recognised', 'recognized', 'identified as', 'identity',
    'facial', 'face match', 'same person as', 'known person', 'unknown person', 'regular visitor',
  ],
}

/** Gendered job words are rewritten to neutral ones instead of being dropped. */
export const NEUTRAL_REWRITES: Record<string, string> = {
  mailman: 'mail carrier',
  postman: 'mail carrier',
  deliveryman: 'delivery driver',
  'delivery man': 'delivery driver',
  'delivery guy': 'delivery driver',
  'delivery woman': 'delivery driver',
  repairman: 'repair worker',
  workman: 'worker',
  policeman: 'police officer',
  fireman: 'firefighter',
}

/** Colour words only become race terms when attached to a person noun ("white man"). */
export const COLOUR_PERSON_PATTERN = new RegExp(
  `\\b(?:white|black|brown|yellow|red|dark|light|fair|tan|olive)[-\\s]+${PERSON_NOUNS}\\b`,
  'i'
)

/** Height and build words only count as body descriptors next to a person noun. */
export const BODY_PERSON_PATTERN = new RegExp(`\\b(?:tall|short|big|small|large|heavy|little)[-\\s]+${PERSON_NOUNS}\\b`, 'i')

// Words in BODY list that are too common in clothing or object text to block alone.
export const CONTEXT_ONLY_BODY = new Set(['tall', 'short'])

/** Well-known carriers and brands may appear on vans and boxes; they are not people. */
export const BRAND_ALLOWLIST = new Set([
  'amazon', 'prime', 'ups', 'usps', 'fedex', 'dhl', 'ring', 'doordash', 'ubereats', 'uber', 'eats',
  'grubhub', 'instacart', 'walmart', 'target', 'costco', 'zomato', 'swiggy', 'flipkart', 'blinkit',
  'zepto', 'india', 'post', 'royal', 'mail', 'senior', 'stop', 'exit', 'entrance', 'parking',
  'no', 'slow', 'welcome', 'private', 'open', 'closed', 'push', 'pull', 'fragile', 'this', 'side', 'up',
])

/**
 * A short list of common given names. It is a tripwire for the person-name check, not
 * a directory: anything shaped like "Firstname Lastname" is caught by the pattern below.
 */
export const COMMON_GIVEN_NAMES = new Set(
  (
    'james john robert michael william david richard joseph thomas charles christopher daniel matthew ' +
    'anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason ' +
    'jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel ' +
    'mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret ' +
    'sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca ' +
    'sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha ' +
    'katherine christine debra rachel carolyn janet maria olivia sophia priya rahul amit anil sunil ' +
    'raj rajesh suresh ramesh mahesh vijay sanjay ajay deepak arjun rohan aditya ananya aarav vivaan ' +
    'diya isha kavya neha pooja riya sneha shreya anjali koushik debarshi imon sourav subhash arijit ' +
    'mohammed muhammad ahmed ali fatima aisha omar hassan jose juan carlos luis miguel sofia lucia ' +
    'valentina camila wei li chen wang zhang liu yuki hiroshi kenji'
  ).split(/\s+/)
)

export const NAME_CUE_PATTERN = /\b(?:named|called|name is|this is|it'?s|that'?s|mr\.?|mrs\.?|ms\.?|dr\.?)\s+[A-Z][a-z]+/

/** Two or three capitalised words in a row ("Jane Doe") outside the brand list. */
export const CAPITALISED_PAIR = /\b([A-Z][a-z]{1,15})\s+([A-Z][a-z]{1,15})(?:\s+[A-Z][a-z]{1,15})?\b/g

export const PLATE_PATTERNS: RegExp[] = [
  /\b(?:licen[cs]e|number|registration|reg)\s*(?:plate)?\s*(?:number|no\.?|reads|is|:)?\s*[A-Z0-9][A-Z0-9 -]{3,9}\b/i,
  /\b(?=[A-Z0-9-]{5,10}\b)(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{2,4}[- ]?[A-Z0-9]{2,5}\b/, // ABC-1234, 7XYZ123, WB02AB1234
  /\b\d{6,}\b/, // long digit runs: IDs, phone numbers, account numbers
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email
  /\+?\d[\d\s().-]{8,}\d/, // phone
]

export const ADDRESS_PATTERN =
  /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|way|court|ct|place|pl|terrace|close|marg|nagar|path)\b\.?/i
