"use client";

/**
 * Synthesized two-tone chime (Web Audio API, no external asset — no
 * licensing question, no bundle cost) for a due-now dose while the Home
 * screen is already open (docs/16: never depend only on browser push).
 * Best-effort only: browsers require a prior user gesture on the page
 * before any audio (including this) can play — a completely untouched tab
 * may not play it on the very first attempt. The OS push notification is
 * the reliable channel regardless; this silently no-ops on failure rather
 * than surfacing an error for what is deliberately a bonus, not the only alert.
 */
export async function playReminderChime(): Promise<void> {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const tone = (freq: number, startAt: number, durationSec: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, startAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + durationSec);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + durationSec);
    };
    const now = ctx.currentTime;
    tone(800, now, 0.15);
    tone(1000, now + 0.15, 0.2);
    setTimeout(() => void ctx.close(), 500);
  } catch {
    // Autoplay-policy rejection or unsupported API — silently skip.
  }
}
