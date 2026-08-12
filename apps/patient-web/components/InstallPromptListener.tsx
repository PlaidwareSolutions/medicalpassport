"use client";
import { useEffect } from "react";
import { captureInstallPrompt } from "../lib/install-prompt";
import { captureAcquisitionSource } from "../lib/acquisition";

/** Mounted once in the root layout so `beforeinstallprompt` is never missed —
 *  and, on the same first load, the `?src=website` acquisition source is
 *  captured before any client-side navigation drops the query param. */
export function InstallPromptListener() {
  useEffect(() => {
    captureInstallPrompt();
    captureAcquisitionSource();
  }, []);
  return null;
}
