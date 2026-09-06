"use client";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { GuideGlyph } from "../../components/GuideGlyph";
import { PageHeader } from "../../components/PageHeader";
import { ScopeNotice } from "../../components/ScopeGate";
import { activityGlyph, activitySentence, actorName, useActivity } from "../../lib/activity";
import { useI18n } from "../../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../../lib/patient-time";
import { useProfileAccess } from "../../lib/scopes";

/**
 * "Who changed what" (docs_v2/06 P6-3): the answer to the question a
 * patient who has given someone access will eventually ask — what did they
 * actually do?
 *
 * Every row names a person and a change in words. No action codes, no
 * entity ids, no "AUDIT: medication.status_changed" — those are the
 * vocabulary of the audit log, and this screen is the one place that
 * vocabulary is translated (see lib/activity.ts).
 *
 * Reads are not here. Looking is the per-caregiver access log's business
 * (the "when did they look" toggle on /caregivers); this list is about
 * changes, so it stays short enough to be worth reading.
 */
export default function ActivityPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const access = useProfileAccess();
  const { items, error, fromCache, hasMore, loadMore, loadingMore, moreError } = useActivity();

  // The API gates this on `view_profile`; say so before the request 403s.
  if (access.ready && !access.can("view_profile")) {
    return (
      <AppShell>
        <PageHeader title={t("activity.title")} />
        <ScopeNotice action="view_profile" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("activity.title")} readAloud={[{ audio: "screen.activity" }]} />

      {error && !items ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="people" titleKey="activity.empty_title" bodyKey="activity.empty_body" />
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {(items ?? []).map((item) => (
          <Card key={item.id} data-testid="activity-row">
            <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
              <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                <GuideGlyph name={activityGlyph(item)} size="md" />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                {/* Who first, then what: the person is the reason this screen
                    exists — the change itself is already on the timeline. */}
                <strong style={{ overflowWrap: "anywhere" }}>{actorName(t, item)}</strong>
                <div style={{ overflowWrap: "anywhere" }}>{activitySentence(t, item)}</div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {formatPatientDateTime(item.occurredAt, timezone)}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {moreError ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {hasMore ? (
        <div style={{ marginTop: "var(--space-md)" }}>
          <Button variant="secondary" fullWidth loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>
            {t("health.show_more")}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}
