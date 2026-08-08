"use client";
import { useSyncExternalStore } from "react";

/**
 * Add-to-home-screen plumbing (docs/07 screen 37). Chromium fires
 * `beforeinstallprompt` early — often before any screen that wants it has
 * mounted — so `InstallPromptListener` (in the root layout) captures it into
 * this module singleton and education UI asks for it later. iOS has no
 * install prompt API at all; there the answer is manual Safari steps.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let captured = false;
let version = 0;
const listeners = new Set<() => void>();
function notify() {
  version += 1;
  for (const l of listeners) l();
}

export function captureInstallPrompt() {
  if (captured || typeof window === "undefined") return;
  captured = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

// Module scope, not an effect: Chrome may fire `beforeinstallprompt` before
// React finishes hydrating, and the event never refires once missed. Next's
// deferred bundles execute before `window.load`, so this is early enough.
captureInstallPrompt();

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  // iPadOS 13+ reports itself as Mac; the touch-points check catches it.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export type InstallAvailability = "native" | "ios-manual" | "none";

export function useInstallPrompt(): {
  availability: InstallAvailability;
  /** Only meaningful when availability is "native". */
  promptInstall: () => Promise<"accepted" | "dismissed">;
} {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
  const availability: InstallAvailability =
    typeof window === "undefined" || isStandalone()
      ? "none"
      : deferredPrompt
        ? "native"
        : isIos()
          ? "ios-manual"
          : "none";
  return {
    availability,
    promptInstall: async () => {
      const prompt = deferredPrompt;
      if (!prompt) return "dismissed";
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferredPrompt = null;
      notify();
      return choice.outcome;
    },
  };
}
