import type { Language } from '../pipeline/types'

// Closed vocabularies per language. Because the vision model only emits enum values,
// every word spoken in Hindi, Bengali or Spanish comes from this file, never from a
// model, so nothing unguarded is translated on the fly.

type Dict = Record<string, string>
export type Gendered = { m: string; f: string }

export const OBJECTS: Record<Language, Dict> = {
  en: {
    parcel: 'a parcel', flat_parcel: 'a flat parcel', bag: 'a bag', grocery_bag: 'grocery bags', food_delivery: 'a food delivery bag',
    envelope: 'an envelope', flowers: 'flowers', umbrella: 'an umbrella', bicycle: 'a bicycle', scooter: 'a scooter', pram: 'a pram',
    trolley: 'a trolley', tool: 'a tool', ladder: 'a ladder', bin: 'a bin', sign: 'a sign', other: 'something',
  },
  hi: {
    parcel: 'एक पार्सल', flat_parcel: 'एक चपटा पार्सल', bag: 'एक थैला', grocery_bag: 'किराने के थैले', food_delivery: 'खाने की डिलीवरी का बैग',
    envelope: 'एक लिफ़ाफ़ा', flowers: 'फूल', umbrella: 'एक छाता', bicycle: 'एक साइकिल', scooter: 'एक स्कूटर', pram: 'एक बच्चागाड़ी',
    trolley: 'एक ट्रॉली', tool: 'एक औज़ार', ladder: 'एक सीढ़ी', bin: 'एक कूड़ेदान', sign: 'एक बोर्ड', other: 'कुछ सामान',
  },
  bn: {
    parcel: 'একটি পার্সেল', flat_parcel: 'একটি চ্যাপ্টা পার্সেল', bag: 'একটি ব্যাগ', grocery_bag: 'বাজারের ব্যাগ', food_delivery: 'খাবার ডেলিভারির ব্যাগ',
    envelope: 'একটি খাম', flowers: 'ফুল', umbrella: 'একটি ছাতা', bicycle: 'একটি সাইকেল', scooter: 'একটি স্কুটার', pram: 'একটি প্র্যাম',
    trolley: 'একটি ট্রলি', tool: 'একটি যন্ত্র', ladder: 'একটি মই', bin: 'একটি ডাস্টবিন', sign: 'একটি সাইনবোর্ড', other: 'কিছু একটা',
  },
  es: {
    parcel: 'un paquete', flat_parcel: 'un paquete plano', bag: 'una bolsa', grocery_bag: 'bolsas de la compra', food_delivery: 'una bolsa de comida a domicilio',
    envelope: 'un sobre', flowers: 'flores', umbrella: 'un paraguas', bicycle: 'una bicicleta', scooter: 'un patinete', pram: 'un cochecito',
    trolley: 'un carrito', tool: 'una herramienta', ladder: 'una escalera', bin: 'un contenedor', sign: 'un cartel', other: 'algo',
  },
}

export const VEHICLES: Record<Language, Dict> = {
  en: { car: 'car', van: 'van', truck: 'lorry', motorcycle: 'motorbike', bicycle: 'bicycle', bus: 'bus', suv: 'SUV', other: 'vehicle' },
  hi: { car: 'कार', van: 'वैन', truck: 'ट्रक', motorcycle: 'मोटरसाइकिल', bicycle: 'साइकिल', bus: 'बस', suv: 'एसयूवी', other: 'गाड़ी' },
  bn: { car: 'গাড়ি', van: 'ভ্যান', truck: 'ট্রাক', motorcycle: 'মোটরবাইক', bicycle: 'সাইকেল', bus: 'বাস', suv: 'এসইউভি', other: 'যানবাহন' },
  es: { car: 'coche', van: 'furgoneta', truck: 'camión', motorcycle: 'moto', bicycle: 'bicicleta', bus: 'autobús', suv: 'todoterreno', other: 'vehículo' },
}

/** Spanish nouns need agreement: un coche blanco / una furgoneta blanca. */
export const ES_VEHICLE_GENDER: Record<string, 'm' | 'f'> = {
  car: 'm', van: 'f', truck: 'm', motorcycle: 'f', bicycle: 'f', bus: 'm', suv: 'm', other: 'm',
}

export const COLOURS: Record<Exclude<Language, 'es'>, Dict> & { es: Record<string, Gendered> } = {
  en: {
    black: 'black', white: 'white', grey: 'grey', silver: 'silver', red: 'red', orange: 'orange', yellow: 'yellow', green: 'green',
    blue: 'blue', purple: 'purple', pink: 'pink', brown: 'brown', beige: 'beige', unknown: '',
  },
  hi: {
    black: 'काली', white: 'सफ़ेद', grey: 'स्लेटी', silver: 'सिल्वर', red: 'लाल', orange: 'नारंगी', yellow: 'पीली', green: 'हरी',
    blue: 'नीली', purple: 'बैंगनी', pink: 'गुलाबी', brown: 'भूरी', beige: 'हल्की भूरी', unknown: '',
  },
  bn: {
    black: 'কালো', white: 'সাদা', grey: 'ধূসর', silver: 'রুপোলি', red: 'লাল', orange: 'কমলা', yellow: 'হলুদ', green: 'সবুজ',
    blue: 'নীল', purple: 'বেগুনি', pink: 'গোলাপি', brown: 'বাদামি', beige: 'হালকা বাদামি', unknown: '',
  },
  es: {
    black: { m: 'negro', f: 'negra' }, white: { m: 'blanco', f: 'blanca' }, grey: { m: 'gris', f: 'gris' }, silver: { m: 'plateado', f: 'plateada' },
    red: { m: 'rojo', f: 'roja' }, orange: { m: 'naranja', f: 'naranja' }, yellow: { m: 'amarillo', f: 'amarilla' }, green: { m: 'verde', f: 'verde' },
    blue: { m: 'azul', f: 'azul' }, purple: { m: 'morado', f: 'morada' }, pink: { m: 'rosa', f: 'rosa' }, brown: { m: 'marrón', f: 'marrón' },
    beige: { m: 'beis', f: 'beis' }, unknown: { m: '', f: '' },
  },
}

export const ANIMALS: Record<Language, Dict> = {
  en: { dog: 'A dog', cat: 'A cat', bird: 'A bird', other: 'An animal' },
  hi: { dog: 'एक कुत्ता', cat: 'एक बिल्ली', bird: 'एक पक्षी', other: 'एक जानवर' },
  bn: { dog: 'একটি কুকুর', cat: 'একটি বিড়াল', bird: 'একটি পাখি', other: 'একটি প্রাণী' },
  es: { dog: 'Un perro', cat: 'Un gato', bird: 'Un pájaro', other: 'Un animal' },
}

export const NUMBERS: Record<Language, string[]> = {
  en: ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'],
  hi: ['कोई', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह'],
  bn: ['কোনো', 'একজন', 'দুজন', 'তিনজন', 'চারজন', 'পাঁচজন', 'ছয়জন'],
  es: ['Ninguna', 'Una', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis'],
}

export const T = {
  doorbell: { en: 'Doorbell.', hi: 'दरवाज़े की घंटी।', bn: 'দরজার বেল।', es: 'Timbre.' },
  hedge: { en: 'Looks like', hi: 'लगता है', bn: 'মনে হচ্ছে', es: 'Parece que hay' },
  unsure: {
    en: (cam: string) => `Motion at the ${cam}. I can't tell what it is yet.`,
    hi: (cam: string) => `${cam} पर हलचल। अभी साफ़ नहीं है कि क्या है।`,
    bn: (cam: string) => `${cam}-এ নড়াচড়া। এখনও বোঝা যাচ্ছে না কী।`,
    es: (cam: string) => `Movimiento en ${cam}. Todavía no sé qué es.`,
  },
  nothing: {
    en: (cam: string) => `Motion at the ${cam}. Nothing is visible now.`,
    hi: (cam: string) => `${cam} पर हलचल। अभी कुछ दिखाई नहीं दे रहा।`,
    bn: (cam: string) => `${cam}-এ নড়াচড়া। এখন কিছু দেখা যাচ্ছে না।`,
    es: (cam: string) => `Movimiento en ${cam}. Ahora no se ve nada.`,
  },
  fallback: {
    en: (cam: string) => `Motion detected at ${cam}.`,
    hi: (cam: string) => `${cam} पर हलचल हुई है।`,
    bn: (cam: string) => `${cam}-এ নড়াচড়া দেখা গেছে।`,
    es: (cam: string) => `Movimiento detectado en ${cam}.`,
  },
  e2ee: {
    en: (cam: string) => `${cam}: this camera uses end-to-end encryption, so I can't describe it.`,
    hi: (cam: string) => `${cam}: यह कैमरा एंड-टू-एंड एन्क्रिप्टेड है, इसलिए इसका वर्णन संभव नहीं है।`,
    bn: (cam: string) => `${cam}: এই ক্যামেরা এন্ড-টু-এন্ড এনক্রিপ্টেড, তাই বর্ণনা করা যাচ্ছে না।`,
    es: (cam: string) => `${cam}: esta cámara usa cifrado de extremo a extremo, así que no puedo describirla.`,
  },
  noFrame: {
    en: (cam: string) => `Activity at the ${cam}. No picture is available yet.`,
    hi: (cam: string) => `${cam} पर गतिविधि। अभी कोई तस्वीर उपलब्ध नहीं है।`,
    bn: (cam: string) => `${cam}-এ কার্যকলাপ। এখনও কোনো ছবি পাওয়া যায়নি।`,
    es: (cam: string) => `Actividad en ${cam}. Todavía no hay imagen.`,
  },
  identity: {
    en: "I don't identify people.",
    hi: 'लोगों की पहचान बताना मेरा काम नहीं है।',
    bn: 'আমি মানুষ শনাক্ত করি না।',
    es: 'No identifico a las personas.',
  },
  expected: {
    en: (what: string, time: string) => `This looks like your ${what}, ${time}.`,
    hi: (what: string, time: string) => `यह शायद आपकी ${what} है, ${time}।`,
    bn: (what: string, time: string) => `এটা সম্ভবত আপনার ${what}, ${time}।`,
    es: (what: string, time: string) => `Parece tu ${what}, ${time}.`,
  },
  stillThere: {
    en: (n: string, where: string) => `Yes. ${n} still there${where}.`,
    hi: (n: string, where: string) => `हाँ। ${n} अभी भी वहाँ है${where}।`,
    bn: (n: string, where: string) => `হ্যাঁ। ${n} এখনও আছেন${where}।`,
    es: (n: string, where: string) => `Sí. ${n} sigue ahí${where}.`,
  },
  noOne: {
    en: 'No one is visible at the door now.',
    hi: 'अभी दरवाज़े पर कोई दिखाई नहीं दे रहा।',
    bn: 'এখন দরজায় কাউকে দেখা যাচ্ছে না।',
    es: 'Ahora no se ve a nadie en la puerta.',
  },
  vehicleStill: {
    en: (v: string) => `Yes, ${v} is still there.`,
    hi: (v: string) => `हाँ, ${v} अभी भी वहाँ है।`,
    bn: (v: string) => `হ্যাঁ, ${v} এখনও আছে।`,
    es: (v: string) => `Sí, ${v} sigue ahí.`,
  },
  vehicleGone: {
    en: 'No vehicle is visible now.',
    hi: 'अभी कोई गाड़ी दिखाई नहीं दे रही।',
    bn: 'এখন কোনো গাড়ি দেখা যাচ্ছে না।',
    es: 'Ahora no se ve ningún vehículo.',
  },
  textReads: {
    en: (t: string) => `The text reads: ${t}.`,
    hi: (t: string) => `लिखा है: ${t}।`,
    bn: (t: string) => `লেখা আছে: ${t}।`,
    es: (t: string) => `El texto dice: ${t}.`,
  },
  noText: {
    en: "I can't see any text I'm able to read out.",
    hi: 'पढ़कर सुनाने लायक कोई लिखावट नहीं दिख रही।',
    bn: 'পড়ে শোনানোর মতো কোনো লেখা দেখা যাচ্ছে না।',
    es: 'No veo ningún texto que pueda leer.',
  },
  offline: {
    en: (cam: string) => `${cam} camera is offline.`,
    hi: (cam: string) => `${cam} कैमरा ऑफ़लाइन है।`,
    bn: (cam: string) => `${cam} ক্যামেরা অফলাইন।`,
    es: (cam: string) => `La cámara ${cam} está desconectada.`,
  },
  online: {
    en: (cam: string) => `${cam} camera is back online.`,
    hi: (cam: string) => `${cam} कैमरा फिर से ऑनलाइन है।`,
    bn: (cam: string) => `${cam} ক্যামেরা আবার অনলাইন।`,
    es: (cam: string) => `La cámara ${cam} vuelve a estar conectada.`,
  },
  sensor: {
    en: (what: string) => `Sensor alert: ${what}.`,
    hi: (what: string) => `सेंसर अलर्ट: ${what}।`,
    bn: (what: string) => `সেন্সর সতর্কতা: ${what}।`,
    es: (what: string) => `Alerta de sensor: ${what}.`,
  },
  early: {
    en: (what: string, cam: string) => `${what} at the ${cam}. Checking details.`,
    hi: (what: string, cam: string) => `${cam} पर ${what}। विवरण देखे जा रहे हैं।`,
    bn: (what: string, cam: string) => `${cam}-এ ${what}। বিস্তারিত দেখছি।`,
    es: (what: string, cam: string) => `${what} en ${cam}. Comprobando detalles.`,
  },
  earlyWhat: {
    person: { en: 'Someone', hi: 'कोई व्यक्ति', bn: 'কেউ একজন', es: 'Alguien' },
    package: { en: 'A parcel', hi: 'एक पार्सल', bn: 'একটি পার্সেল', es: 'Un paquete' },
    vehicle: { en: 'A vehicle', hi: 'एक गाड़ी', bn: 'একটি গাড়ি', es: 'Un vehículo' },
    animal: { en: 'An animal', hi: 'एक जानवर', bn: 'একটি প্রাণী', es: 'Un animal' },
    none: { en: 'Movement', hi: 'हलचल', bn: 'নড়াচড়া', es: 'Movimiento' },
  },
  expectationWhat: {
    delivery: { en: 'delivery', hi: 'डिलीवरी', bn: 'ডেলিভারি', es: 'entrega' },
    visitor: { en: 'expected visitor', hi: 'अपेक्षित मेहमान', bn: 'প্রত্যাশিত অতিথি', es: 'visita esperada' },
    vehicle: { en: 'expected vehicle', hi: 'अपेक्षित गाड़ी', bn: 'প্রত্যাশিত গাড়ি', es: 'vehículo esperado' },
    service: { en: 'expected service visit', hi: 'अपेक्षित सर्विस विज़िट', bn: 'প্রত্যাশিত সার্ভিস ভিজিট', es: 'visita de servicio esperada' },
  },
} as const
