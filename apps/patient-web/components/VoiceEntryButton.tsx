"use client";
import { useEffect, useRef, useState } from "react";
import { Banner, Button } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import type { HubConcept } from "../lib/observations";
import { parseVoiceObservation, recognitionLanguage, type VoiceObservationCandidate } from "../lib/voice/parse-observation";

/**
 * The Web Speech API is not in lib.dom for every TypeScript target and is
 * vendor-prefixed in Chromium; this is the minimal surface used here.
 */
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

/** Feature detection only: no permission prompt until the patient taps. */
export function speechRecognitionAvailable(): boolean {
  return typeof window !== "undefined" && getCtor() !== undefined;
}

function getCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * Voice entry (docs_v2/06 P16). One tap starts listening in the app's
 * locale; the transcript is parsed into a candidate and handed to the
 * sheet, which pre-fills its fields. Nothing is saved from here: text
 * stays primary and the patient still taps Save after checking the
 * numbers (H-19). No audio is retained anywhere; the recognizer's text is
 * shown once as "Heard: …" so a mis-hearing is visible, not silent.
 *
 * Renders nothing where the API is missing (Firefox, older WebViews) so
 * the sheet looks the same as before on those devices.
 */
export function VoiceEntryButton({ concept, onCandidate }: { concept: HubConcept; onCandidate: (candidate: VoiceObservationCandidate, transcript: string) => void }) {
  const { t, locale } = useI18n();
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | undefined>();
  const [error, setError] = useState<"not_understood" | "mic" | undefined>();
  const recognitionRef = useRef<RecognitionLike | undefined>(undefined);

  useEffect(() => {
    setAvailable(speechRecognitionAvailable());
    return () => recognitionRef.current?.abort();
  }, []);

  if (!available) return null;

  function start() {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(undefined);
    setHeard(undefined);
    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = recognitionLanguage(locale);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
      setHeard(transcript);
      const candidate = parseVoiceObservation(transcript, locale, concept);
      if (candidate.value === undefined) {
        setError("not_understood");
        return;
      }
      onCandidate(candidate, transcript);
    };
    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are the patient changing their mind;
      // everything else means the microphone could not be used.
      if (event.error === "no-speech" || event.error === "aborted") setError("not_understood");
      else setError("mic");
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = undefined;
    };
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("mic");
      setListening(false);
    }
  }

  function stop() {
    recognitionRef.current?.stop();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }} data-testid="voice-entry">
      <Button
        variant="secondary"
        fullWidth
        aria-pressed={listening}
        onClick={listening ? stop : start}
        data-testid="voice-entry-button"
      >
        {listening ? t("voice.listening") : t("voice.speak")}
      </Button>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("voice.help")}</span>
      {heard ? (
        <span aria-live="polite" style={{ fontSize: "var(--font-small)" }} data-testid="voice-entry-heard">
          {t("voice.heard", { text: heard })}
        </span>
      ) : null}
      {error === "not_understood" ? <Banner tone="warning">{t("voice.not_understood")}</Banner> : null}
      {error === "mic" ? <Banner tone="warning">{t("voice.error_mic")}</Banner> : null}
    </div>
  );
}
