import type { HubConcept } from "../observations";

/**
 * Voice entry (docs_v2/06 P16): turn a spoken phrase such as
 * "blood pressure 128 over 76" into a CANDIDATE reading. The candidate is
 * only ever pre-filled into the entry sheet; the patient still sees the
 * numbers and taps Save (H-19: a mis-heard value must never be recorded
 * without a person confirming it). Pure and unit-tested; no browser APIs.
 *
 * The grammar is deliberately small: a concept word (or none, when the
 * sheet already knows the concept), one or two numbers, an optional unit
 * word. Anything the parser is not sure about is left blank rather than
 * guessed — an empty field is a prompt, a wrong number is a hazard.
 */
export interface VoiceObservationCandidate {
  concept: HubConcept | undefined;
  /** The primary value as spoken, already normalised to ASCII digits. */
  value?: string;
  /** Second value: the diastolic pressure. */
  value2?: string;
  /** Pulse when spoken after a blood pressure ("pulse 72"). */
  pulse?: string;
  /** A unit word the patient said, mapped to the API's unit code. */
  unit?: string;
  /** Words in the transcript that decided the concept (for the "heard as" line). */
  matched: string[];
}

type Locale = "en" | "hi" | "te" | "ur";

/**
 * Concept words per locale, lower-cased. Every alternative is a word a real
 * speaker might use, including the English loan words that Hindi, Telugu
 * and Urdu speakers use for these measurements; the transcript comes back
 * in the recognizer's own script, so both scripts are listed.
 */
const CONCEPT_WORDS: Record<Locale, Array<[HubConcept, readonly string[]]>> = {
  en: [
    ["blood_pressure", ["blood pressure", "bp", "pressure"]],
    ["blood_glucose", ["blood sugar", "sugar", "glucose"]],
    ["body_weight", ["weight", "weigh"]],
    ["spo2", ["oxygen", "spo2", "saturation"]],
    ["body_temperature", ["temperature", "fever", "temp"]],
    ["heart_rate", ["heart rate", "pulse rate", "heartbeat"]],
    ["body_height", ["height"]],
    ["pain_score", ["pain"]],
  ],
  hi: [
    ["blood_pressure", ["ब्लड प्रेशर", "बीपी", "रक्तचाप", "blood pressure", "bp"]],
    ["blood_glucose", ["शुगर", "शक्कर", "ग्लूकोज़", "ग्लूकोज", "sugar", "glucose"]],
    ["body_weight", ["वज़न", "वजन", "weight"]],
    ["spo2", ["ऑक्सीजन", "oxygen", "spo2"]],
    ["body_temperature", ["तापमान", "बुखार", "temperature", "fever"]],
    ["heart_rate", ["धड़कन", "नब्ज़", "नब्ज", "pulse rate", "heart rate"]],
    ["body_height", ["कद", "लंबाई", "height"]],
    ["pain_score", ["दर्द", "pain"]],
  ],
  te: [
    ["blood_pressure", ["బ్లడ్ ప్రెషర్", "బీపీ", "రక్తపోటు", "blood pressure", "bp"]],
    ["blood_glucose", ["షుగర్", "చక్కెర", "గ్లూకోజ్", "sugar", "glucose"]],
    ["body_weight", ["బరువు", "weight"]],
    ["spo2", ["ఆక్సిజన్", "oxygen", "spo2"]],
    ["body_temperature", ["జ్వరం", "ఉష్ణోగ్రత", "temperature", "fever"]],
    ["heart_rate", ["గుండె వేగం", "నాడి", "pulse rate", "heart rate"]],
    ["body_height", ["ఎత్తు", "height"]],
    ["pain_score", ["నొప్పి", "pain"]],
  ],
  ur: [
    ["blood_pressure", ["بلڈ پریشر", "بی پی", "blood pressure", "bp"]],
    ["blood_glucose", ["شوگر", "گلوکوز", "sugar", "glucose"]],
    ["body_weight", ["وزن", "weight"]],
    ["spo2", ["آکسیجن", "oxygen", "spo2"]],
    ["body_temperature", ["بخار", "درجہ حرارت", "temperature", "fever"]],
    ["heart_rate", ["نبض", "دھڑکن", "pulse rate", "heart rate"]],
    ["body_height", ["قد", "height"]],
    ["pain_score", ["درد", "pain"]],
  ],
};

/** "over", "by", "upon" and their local equivalents: the systolic/diastolic separator. */
const OVER_WORDS = ["over", "by", "upon", "slash", "बटा", "पर", "ఓవర్", "بٹا", "اوپر"];

/** A trailing "pulse N" after a blood pressure. */
const PULSE_WORDS = ["pulse", "नब्ज़", "नब्ज", "धड़कन", "నాడి", "نبض", "دھڑکن"];

/** Unit words → API unit codes (the sheet only applies one its concept allows). */
const UNIT_WORDS: ReadonlyArray<[string, readonly string[]]> = [
  ["kg", ["kg", "kilo", "kilos", "kilogram", "kilograms", "किलो", "కిలో", "کلو"]],
  ["lb", ["lb", "lbs", "pound", "pounds"]],
  ["degC", ["celsius", "centigrade", "सेल्सियस", "సెల్సియస్", "سیلسیس"]],
  ["degF", ["fahrenheit", "फ़ारेनहाइट", "फारेनहाइट", "ఫారెన్‌హీట్", "ఫారెన్హీట్", "فارن ہائیٹ"]],
  ["mmol/L", ["millimole", "millimoles", "mmol"]],
  ["mg/dL", ["milligram", "milligrams", "mg"]],
  ["cm", ["cm", "centimeter", "centimeters", "centimetre", "centimetres", "सेंटीमीटर", "సెంటీమీటర్", "سینٹی میٹر"]],
];

/** Devanagari, Telugu and Arabic-Indic digits → ASCII, so "१२८" reads as 128. */
const DIGIT_MAPS: readonly string[] = ["०१२३४५६७८९", "౦౧౨౩౪౫౬౭౮౯", "۰۱۲۳۴۵۶۷۸۹", "٠١٢٣٤٥٦٧٨٩"];

export function normalizeDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    let mapped: string | undefined;
    for (const map of DIGIT_MAPS) {
      const i = [...map].indexOf(ch);
      if (i >= 0) {
        mapped = String(i);
        break;
      }
    }
    out += mapped ?? ch;
  }
  return out;
}

/** Small number words, so "one twenty eight" is not lost on a recognizer that spells numbers out. */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Replaces runs of number words with digits ("one twenty eight" → "128", "seventy two" → "72"). */
export function wordsToDigits(text: string): string {
  const tokens = text.split(/\s+/);
  const out: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    // "one twenty eight": a leading 1–9 before a tens/hundreds word is a hundreds digit.
    let total = 0;
    let i = 0;
    if (run.length >= 2 && run[0]! < 10 && run[1]! >= 20 && run[1]! !== 100) {
      total = run[0]! * 100;
      i = 1;
    }
    for (; i < run.length; i += 1) {
      const n = run[i]!;
      if (n === 100) total = (total === 0 ? 1 : total) * 100;
      else total += n;
    }
    out.push(String(total));
    run = [];
  };
  for (const token of tokens) {
    const n = NUMBER_WORDS[token.toLowerCase()];
    if (n === undefined) {
      flush();
      out.push(token);
    } else {
      run.push(n);
    }
  }
  flush();
  return out.join(" ");
}

function findConcept(text: string, locale: Locale): { concept: HubConcept; matched: string } | undefined {
  // Longest alternative first so "blood pressure" wins over "pressure" and
  // "pulse rate" over a trailing "pulse".
  const candidates = CONCEPT_WORDS[locale]
    .flatMap(([concept, words]) => words.map((w) => ({ concept, w })))
    .sort((a, b) => b.w.length - a.w.length);
  for (const { concept, w } of candidates) {
    if (text.includes(w)) return { concept, matched: w };
  }
  return undefined;
}

const NUMBER_RE = /\d+(?:[.,]\d+)?/g;

/**
 * Parses a transcript. `knownConcept` is the concept of the sheet that is
 * open; when set, the concept words are optional and a plain "128 over 76"
 * is enough.
 */
export function parseVoiceObservation(transcript: string, locale: string, knownConcept?: HubConcept): VoiceObservationCandidate {
  const loc: Locale = locale === "hi" || locale === "te" || locale === "ur" ? locale : "en";
  const text = wordsToDigits(normalizeDigits(transcript)).toLowerCase().replace(/\s+/g, " ").trim();
  const found = findConcept(text, loc);
  const concept = found?.concept ?? knownConcept;
  const matched = found ? [found.matched] : [];
  const candidate: VoiceObservationCandidate = { concept, matched };
  if (!concept) return candidate;

  const numbers = [...text.matchAll(NUMBER_RE)].map((m) => ({ text: m[0]!.replace(",", "."), index: m.index ?? 0 }));
  if (numbers.length === 0) return candidate;

  if (concept === "blood_pressure") {
    // Two numbers, in order, with or without a separator word ("128 76"
    // is what most recognizers return for "128 by 76"). A third number,
    // or one introduced by a pulse word, is the pulse.
    const [a, b, c] = numbers;
    if (a && b) {
      const between = text.slice(a.index + a.text.length, b.index);
      const separated = between.trim() === "" || OVER_WORDS.some((w) => between.includes(w)) || /[\/-]/.test(between);
      if (separated) {
        candidate.value = a.text;
        candidate.value2 = b.text;
        matched.push(between.trim() || "/");
      }
      const pulseMentioned = PULSE_WORDS.some((w) => text.includes(w));
      if (c && (pulseMentioned || separated)) candidate.pulse = c.text;
    } else if (a) {
      // A single number could be either pressure; leave it for the patient.
      candidate.value = a.text;
    }
    return candidate;
  }

  const first = numbers[0]!;
  candidate.value = first.text;
  const after = text.slice(first.index + first.text.length);
  for (const [code, words] of UNIT_WORDS) {
    if (words.some((w) => after.includes(w))) {
      candidate.unit = code;
      matched.push(words.find((w) => after.includes(w))!);
      break;
    }
  }
  if (concept === "pain_score") {
    // 0–10 only; anything else is a mis-hearing, not a reading.
    const n = Number(candidate.value);
    if (!Number.isInteger(n) || n < 0 || n > 10) delete candidate.value;
  }
  return candidate;
}

/** BCP-47 tag the recognizer should listen in, per app locale. */
export function recognitionLanguage(locale: string): string {
  switch (locale) {
    case "hi":
      return "hi-IN";
    case "te":
      return "te-IN";
    case "ur":
      return "ur-IN";
    default:
      return "en-IN";
  }
}
