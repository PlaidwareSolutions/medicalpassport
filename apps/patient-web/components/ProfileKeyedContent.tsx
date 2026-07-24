"use client";
import { Fragment, type ReactNode } from "react";
import { useSession } from "../lib/session";

/**
 * Forces the whole page under it to unmount and remount on a profile
 * switch. Every page component calls its own data hooks (useMedications,
 * useTimeline, useSafetyFindings, ...) directly in its function body,
 * *before* it ever renders AppShell — so a remount key placed inside
 * AppShell (e.g. on its own <main>) only resets what AppShell wraps as
 * `children`, never the page component itself, which means those hooks'
 * fetched-for-the-old-profile data survives a switch untouched until a hard
 * reload. This must key the page component's own render position — right
 * where Next's App Router hands a route its `children` — so the hooks
 * themselves re-run against the newly active profile (docs/10 H-13:
 * wrong-patient data must never survive a switch, even via stale hook
 * state, not just stale UI).
 */
export function ProfileKeyedContent({ children }: { children: ReactNode }) {
  const { activeProfileId } = useSession();
  return <Fragment key={activeProfileId ?? "none"}>{children}</Fragment>;
}
