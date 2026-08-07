"use client";
import { useEffect, useSyncExternalStore } from "react";
import { t as translate, type Locale } from "@medpass/localization";
import { GUIDANCE_AUDIO_ENTRIES, type GuidanceAudioId } from "./guidance-audio-entries";
import { GUIDANCE_AUDIO } from "./guidance-audio-manifest";

/**
 * Read-aloud engine (docs/07 screen 20, docs/32 TTS row, docs/33
 * low-literacy support). Replaces the original one-off `speak()` on the
 * medicine-detail screen, whose utterance carried no `lang` — a Telugu
 * screen read by whatever voice the browser defaulted to.
 *
 * Per-segment fallback order (docs/32: text always primary, never pretend):
 * 1. Pre-generated MP3 for the current locale (guidance entries only) —
 *    always preferred: consistent voice, works for te/ur on every browser.
 * 2. Browser TTS with a voice matching the locale, `lang` set from the
 *    matched voice.
 * 3. For text with no native-script characters (Latin brand names, digits),
 *    an English voice — "Metformin 500" is readable by it; Telugu script is
 *    not, so mixed-script text is NOT handed to a wrong-language voice.
 * 4. Otherwise the segment is unplayable; a button whose every segment is
 *    unplayable renders nothing at all.
 */

export type SpeechSegment = { audio: GuidanceAudioId } | { text: string };

const SLOW_KEY = "medpass_readaloud_slow";

// --- module store (one playback app-wide; ReadAloud buttons subscribe) ---

let version = 0;
const listeners = new Set<() => void>();
function notify() {
  version += 1;
  for (const l of listeners) l();
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** `useId` of the ReadAloud button whose playback is running, or null. */
let playingOwner: string | null = null;
/** Invalidates every pending onended/onend callback of an older playback. */
let playToken = 0;
let currentAudio: HTMLAudioElement | null = null;

function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

// --- voices ------------------------------------------------------------

let voices: SpeechSynthesisVoice[] = [];
let voicesWatched = false;

/**
 * `getVoices()` is async in practice: Chrome for Android returns [] until
 * `voiceschanged`, and iOS Safari has been seen returning [] until the first
 * user interaction. Watch both signals and re-render subscribers when the
 * list lands.
 */
function watchVoices() {
  if (voicesWatched || !ttsSupported()) return;
  voicesWatched = true;
  const read = () => {
    const next = window.speechSynthesis.getVoices();
    if (next.length !== voices.length) {
      voices = next;
      notify();
    }
  };
  read();
  const synth = window.speechSynthesis;
  if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", read);
  else synth.onvoiceschanged = read;
  window.addEventListener("pointerdown", read, { once: true });
}

function normLang(lang: string): string {
  return lang.toLowerCase().replace(/_/g, "-");
}

/** Exact tag beats prefix ("te" must find "te-IN"; "en" prefers "en" over "en-IN" only if both exist). */
function voiceFor(locale: string): SpeechSynthesisVoice | undefined {
  const want = normLang(locale);
  return (
    voices.find((v) => normLang(v.lang) === want) ??
    voices.find((v) => normLang(v.lang).startsWith(`${want}-`)) ??
    voices.find((v) => normLang(v.lang).startsWith(want))
  );
}

/** True when the text has Latin letters and no other script — safe for an English voice. */
function latinOnly(text: string): boolean {
  let latin = 0;
  for (const ch of text) {
    if (/[a-zA-Z]/.test(ch)) latin += 1;
    else if (/\p{L}/u.test(ch)) return false;
  }
  return latin > 0;
}

// --- segment resolution -------------------------------------------------

type PlaybackStep =
  | { kind: "file"; url: string; fallbackText: string }
  | { kind: "tts"; text: string; voice: SpeechSynthesisVoice };

function guidanceText(id: GuidanceAudioId, locale: Locale): string {
  return GUIDANCE_AUDIO_ENTRIES[id].sourceKeys.map((k) => translate(locale, k)).join(" ");
}

function resolveText(text: string, locale: Locale): PlaybackStep | null {
  const trimmed = text.trim();
  if (!trimmed || !ttsSupported()) return null;
  const voice = voiceFor(locale);
  if (voice) return { kind: "tts", text: trimmed, voice };
  const english = voiceFor("en");
  if (english && latinOnly(trimmed)) return { kind: "tts", text: trimmed, voice: english };
  return null;
}

function resolveSegment(segment: SpeechSegment, locale: Locale): PlaybackStep | null {
  if ("audio" in segment) {
    const text = guidanceText(segment.audio, locale);
    const asset = GUIDANCE_AUDIO[segment.audio]?.[locale];
    if (asset) return { kind: "file", url: `/audio/guidance/${asset.file}`, fallbackText: text };
    return resolveText(text, locale);
  }
  return resolveText(segment.text, locale);
}

// --- playback -----------------------------------------------------------

function isSlow(): boolean {
  try {
    return window.localStorage.getItem(SLOW_KEY) === "1";
  } catch {
    return false;
  }
}

function setSlow(value: boolean) {
  try {
    window.localStorage.setItem(SLOW_KEY, value ? "1" : "0");
  } catch {
    // Private mode without storage: the toggle still applies to the next play.
  }
  if (currentAudio) currentAudio.playbackRate = value ? 0.85 : 1;
  notify();
}

export function stopReadAloud() {
  playToken += 1;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (ttsSupported()) window.speechSynthesis.cancel();
  if (playingOwner !== null) {
    playingOwner = null;
    notify();
  }
}

/** Stops only if `owner`'s playback is the one running — for unmount cleanup. */
export function stopReadAloudIfOwner(owner: string) {
  if (playingOwner === owner) stopReadAloud();
}

/**
 * iOS stalls on long utterances (~15s+), so dynamic text is split at sentence
 * ends (including danda and Urdu full stop) and packed into ≤200-char chunks.
 */
function sentenceChunks(text: string): string[] {
  const sentences = text.split(/(?<=[.।۔!?؟])\s+/u);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > 200) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function speakStep(step: Extract<PlaybackStep, { kind: "tts" }>, token: number, done: () => void) {
  const chunks = sentenceChunks(step.text);
  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.voice = step.voice;
    utterance.lang = step.voice.lang;
    utterance.rate = isSlow() ? 0.8 : 1;
    if (i === chunks.length - 1) {
      const finish = () => {
        if (token === playToken) done();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
    }
    window.speechSynthesis.speak(utterance);
  });
}

function playSteps(steps: PlaybackStep[], locale: Locale, token: number, index: number) {
  if (token !== playToken) return;
  if (index >= steps.length) {
    currentAudio = null;
    playingOwner = null;
    notify();
    return;
  }
  const step = steps[index];
  const next = () => playSteps(steps, locale, token, index + 1);
  if (!step) {
    next();
    return;
  }
  if (step.kind === "file") {
    const audio = new Audio(step.url);
    currentAudio = audio;
    audio.playbackRate = isSlow() ? 0.85 : 1;
    let failed = false;
    const fail = () => {
      // Offline before the SW cached this file, or a bad deploy: degrade to
      // reading the same text rather than dying silently.
      if (failed || token !== playToken) return;
      failed = true;
      const fallback = resolveText(step.fallbackText, locale);
      if (fallback && fallback.kind === "tts") speakStep(fallback, token, next);
      else next();
    };
    audio.onended = next;
    audio.onerror = fail;
    // Must stay synchronous relative to the triggering click for the first
    // step — iOS revokes the user-gesture activation across awaits.
    void audio.play().catch(fail);
  } else {
    speakStep(step, token, next);
  }
}

function playReadAloud(segments: SpeechSegment[], locale: Locale, owner: string) {
  stopReadAloud();
  const steps = segments
    .map((segment) => resolveSegment(segment, locale))
    .filter((step): step is PlaybackStep => step !== null);
  if (steps.length === 0) return;
  const token = playToken;
  playingOwner = owner;
  notify();
  playSteps(steps, locale, token, 0);
}

// --- hook ---------------------------------------------------------------

export function useReadAloud() {
  useEffect(watchVoices, []);
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
  return {
    /** Owner id of the running playback (compare with your own `useId`). */
    playingOwner,
    slow: typeof window === "undefined" ? false : isSlow(),
    setSlow,
    playable: (segments: SpeechSegment[], locale: Locale) =>
      segments.some((segment) => resolveSegment(segment, locale) !== null),
    play: playReadAloud,
    stop: stopReadAloud,
  };
}
