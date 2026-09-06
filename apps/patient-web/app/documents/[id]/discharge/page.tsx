"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Card } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { GuideGlyph } from "../../../../components/GuideGlyph";
import { PageHeader } from "../../../../components/PageHeader";
import { useI18n } from "../../../../lib/i18n";

/**
 * Hospital discharge (docs_v2/10 H-34). A discharge summary lists what the
 * ward gave, what was stopped and what changed — proposing its medicine
 * lines as "current medicines" is exactly the hazard. So this screen
 * explains and stops: there is deliberately NO "add these medicines"
 * action here or anywhere downstream of a discharge summary. The document
 * is kept and goes through the transition workflow with the doctor
 * (Phase 14).
 */
export default function DischargeExplanationPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();

  return (
    <AppShell>
      <PageHeader title={t("documents.discharge_title")} readAloud={[{ text: `${t("documents.discharge_body_1")} ${t("documents.discharge_body_2")}` }]} />
      <Card tone="info" data-testid="discharge-explanation">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-sm)", textAlign: "center", padding: "var(--space-sm) 0" }}>
          <span style={{ color: "var(--color-primary)" }}>
            <GuideGlyph name="hospital" size="lg" />
          </span>
          <p style={{ margin: 0 }}>{t("documents.discharge_body_1")}</p>
          <p style={{ margin: 0 }}>{t("documents.discharge_body_2")}</p>
          <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("documents.discharge_body_3")}</p>
        </div>
      </Card>
      <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Link href={`/documents/${params.id}`}>
          <Button fullWidth>{t("documents.see_document")}</Button>
        </Link>
        <Link href="/health/visits/new">
          <Button variant="secondary" fullWidth>
            {t("documents.discharge_record_visit")}
          </Button>
        </Link>
        <Link href="/documents">
          <Button variant="ghost" fullWidth>
            {t("documents.back_to_list")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
