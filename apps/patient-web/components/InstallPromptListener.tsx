"use client";
import { useEffect } from "react";
import { captureInstallPrompt } from "../lib/install-prompt";

/** Mounted once in the root layout so `beforeinstallprompt` is never missed. */
export function InstallPromptListener() {
  useEffect(captureInstallPrompt, []);
  return null;
}
