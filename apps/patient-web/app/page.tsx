"use client";
import Link from "next/link";
import { Banner, Button, Card, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../components/AppShell";
import { useI18n } from "../lib/i18n";
import { useMedications, instructionSummary } from "../lib/medications";

/**
 * Screen 7: Home (docs/07). Priority order: due now → due next → missed →
 * concerns → refills. Scheduling arrives in Stage 4; until then the current
 * medicines and an honest "coming soon" note fill the space.
 */
export default function HomePage() {
  const { t } = useI18n();
  const { items, error, reload } = useMedications("current");

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("nav.home")}</h1>

      {error ? (
        <Card tone="danger">
          {t("common.error_generic")}
          <Button variant="secondary" onClick={() => void reload()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {items === undefined && !error ? <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p> : null}

      {items !== undefined && items.length === 0 ? (
        <Card>
          <strong>{t("home.empty_title")}</strong>
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{t("home.empty_body")}</p>
          <Link href="/add">
            <Button fullWidth>{t("home.add_first")}</Button>
          </Link>
        </Card>
      ) : null}

      {items !== undefined && items.length > 0 ? (
        <>
          <Banner tone="info">{t("home.schedule_coming")}</Banner>
          <SectionTitle>{t("meds.current")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {items.map((m) => (
              <Link key={m.id} href={`/medicines/${m.id}`}>
                <Card>
                  <strong style={{ fontSize: "var(--font-large)" }}>
                    {m.product?.brandName ?? m.enteredName}
                  </strong>
                  {m.product ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {m.product.ingredients.map((i) => i.name).join(" + ")} {m.product.strengthLabel ?? ""}
                    </span>
                  ) : null}
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {instructionSummary(m, t as never)}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
