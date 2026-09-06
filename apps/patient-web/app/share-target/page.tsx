"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { GuideGlyph } from "../../components/GuideGlyph";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { readSharedFiles } from "../../lib/share-target-inbox";

/**
 * Web Share Target landing (docs_v2/09 §3, docs_v2/10 H-38). The service
 * worker parked the shared files and redirected here. Before anything is
 * uploaded the person says WHOSE document this is — every profile the
 * account manages is offered, none pre-selected, even when there is only
 * one, because a WhatsApp forward of a mother's report can land on a son's
 * phone and must never auto-attach to the wrong passport. The choice
 * becomes the active profile and the capture screen takes over with
 * `sourceChannel: "share_target"`.
 */
function ShareTargetLanding() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profiles, selectProfile } = useSession();
  const [files, setFiles] = useState<File[] | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
  const failed = searchParams.get("error") === "1";

  useEffect(() => {
    let cancelled = false;
    readSharedFiles()
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function proceed() {
    if (!chosen) return;
    selectProfile(chosen);
    router.replace("/documents/new?source=share_target");
  }

  return (
    <AppShell>
      <PageHeader title={t("documents.share_title")} readAloud={[{ text: t("guide.screen.share_target") }]} />
      {failed ? <Banner tone="danger">{t("documents.share_failed")}</Banner> : null}

      {files === undefined ? <PillSpinner label={t("common.loading")} /> : null}

      {files && files.length === 0 ? (
        <EmptyState glyph="document" titleKey="documents.share_empty_title" bodyKey="documents.share_empty_body" cta={{ labelKey: "documents.add", href: "/documents/new" }} />
      ) : null}

      {files && files.length > 0 ? (
        <>
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <span style={{ color: "var(--color-primary)" }}>
                <GuideGlyph name="document" size="lg" />
              </span>
              <div style={{ minWidth: 0 }}>
                <strong>{t("documents.share_received", { n: files.length })}</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", overflowWrap: "anywhere" }}>{files.map((f) => f.name).join(", ")}</div>
              </div>
            </div>
          </Card>

          <SectionTitle>{t("documents.share_whose")}</SectionTitle>
          <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-sm)" }}>{t("documents.share_whose_hint")}</p>
          <div role="radiogroup" aria-label={t("documents.share_whose")} style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {profiles.map((p) => {
              const active = p.id === chosen;
              return (
                <Button key={p.id} role="radio" aria-checked={active} variant={active ? "primary" : "secondary"} fullWidth onClick={() => setChosen(p.id)} data-testid="share-profile">
                  {active ? "✓ " : ""}
                  {p.displayName}
                </Button>
              );
            })}
          </div>

          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth disabled={!chosen} onClick={proceed}>
              {t("documents.share_continue")}
            </Button>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

export default function ShareTargetPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <PillSpinner label="…" />
        </AppShell>
      }
    >
      <ShareTargetLanding />
    </Suspense>
  );
}
