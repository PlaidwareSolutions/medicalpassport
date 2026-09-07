"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { GuideGlyph } from "../../components/GuideGlyph";
import { PageHeader } from "../../components/PageHeader";
import { useFamily, type FamilyProfileDto } from "../../lib/family";
import { useI18n } from "../../lib/i18n";
import { displayUnit, formatObservationValue, isHubConcept } from "../../lib/observations";
import { formatPatientDateTime, useActiveTimezone } from "../../lib/patient-time";
import { scopeLabelKey } from "../../lib/scopes";
import { useSession } from "../../lib/session";

/**
 * The family dashboard (docs_v2/06 P6-3): every profile this account can
 * act on, on one screen, so a daughter looking after two parents does not
 * have to switch profile twice just to find out whether anything needs her
 * today.
 *
 * The rule that shapes every card: a summary field the caller's scopes do
 * not grant comes back null, and null is rendered as a sentence saying so —
 * never as a blank and never as a zero. "Nothing due today" and "not yours
 * to see" are different facts, and collapsing them would quietly tell a
 * caregiver that a parent has no doses left when in truth they were never
 * shown the schedule.
 */
export default function FamilyDashboardPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { activeProfileId, selectProfile } = useSession();
  const { items, error, fromCache, reload } = useFamily();

  function openProfile(id: string) {
    // Same switch the global ProfileSwitcher performs (docs/10 H-13): set the
    // active profile, then land on its home — ProfileKeyedContent remounts
    // the tree, so no screen can render one patient's data under another's name.
    selectProfile(id);
    router.push("/");
  }

  return (
    <AppShell>
      <PageHeader title={t("household.title")} readAloud={[{ audio: "screen.family" }]} />

      {error && !items ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="family" titleKey="household.empty_title" bodyKey="household.empty_body" />
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {(items ?? []).map((profile) => (
          <FamilyCard
            key={profile.id}
            profile={profile}
            isActive={profile.id === activeProfileId}
            onOpen={() => openProfile(profile.id)}
          />
        ))}
      </div>

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
          <Link href="/activity">
            <Button variant="secondary" fullWidth>
              {t("activity.title")}
            </Button>
          </Link>
          <Button variant="secondary" fullWidth onClick={() => void reload()}>
            {t("household.refresh")}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}

function FamilyCard({ profile, isActive, onOpen }: { profile: FamilyProfileDto; isActive: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { summary } = profile;

  return (
    <Card data-testid="family-card" data-profile-id={profile.id}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", minWidth: 0 }}>
          <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
            <GuideGlyph name="people" size="md" />
          </span>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: "var(--font-large)", overflowWrap: "anywhere" }}>{profile.displayName}</strong>
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t(`household.relationship.${profile.relationship}` as never)}
            </div>
          </div>
        </div>
        {/* Never colour alone (WCAG 1.4.1): the word "Open now" carries it. */}
        {isActive ? <Chip tone="success">{t("household.currently_open")}</Chip> : null}
      </div>

      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <SummaryRow
          label={t("household.doses_due_today")}
          value={summary.dueDosesToday === null ? undefined : t("household.doses_due_value", { count: summary.dueDosesToday })}
        />
        <SummaryRow
          label={t("household.missed_doses")}
          value={summary.openAlerts === null ? undefined : t("household.missed_doses_value", { count: summary.openAlerts })}
        />
        <SummaryRow
          label={t("household.last_reading")}
          value={
            summary.lastMeasurement === null
              ? undefined
              : `${summary.lastMeasurement.label}: ${measurementText(summary.lastMeasurement)} · ${formatPatientDateTime(summary.lastMeasurement.measuredAt, timezone)}`
          }
          /* A caregiver WITH view_measurements on a profile that has no
             readings gets null too — the API cannot tell those apart, so the
             screen says the honest thing for both rather than guessing. */
          emptyIsUnknown
        />
      </dl>

      {profile.relationship === "caregiver" ? (
        <div>
          <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>{t("household.your_access")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginTop: "var(--space-xs)" }}>
            {profile.scopes.length === 0 ? (
              <span style={{ fontSize: "var(--font-small)" }}>{t("household.no_scopes")}</span>
            ) : (
              profile.scopes.map((scope) => <Chip key={scope}>{t(scopeLabelKey(scope))}</Chip>)
            )}
          </div>
        </div>
      ) : null}

      <Button variant={isActive ? "secondary" : "primary"} fullWidth onClick={onOpen}>
        {t("household.open_profile", { name: profile.displayName })}
      </Button>
    </Card>
  );
}

/** `undefined` means "the caller's scopes do not grant this" — said in words, never left blank. */
function SummaryRow({ label, value, emptyIsUnknown }: { label: string; value?: string; emptyIsUnknown?: boolean }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap" }}>
      <dt style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "end", minWidth: 0, overflowWrap: "anywhere" }}>
        {value ?? (
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {emptyIsUnknown ? t("household.no_access_or_none") : t("household.no_access")}
          </span>
        )}
      </dd>
    </div>
  );
}

/** Numbers as recorded — two components for blood pressure, never an interpretation (H-25). */
function measurementText(m: NonNullable<FamilyProfileDto["summary"]["lastMeasurement"]>): string {
  // Same display rounding as the diary and the trends (lib/observations):
  // the household card shows the same reading, so it shows the same digits.
  const concept = isHubConcept(m.concept) ? m.concept : undefined;
  const primary = formatObservationValue(m.value, concept);
  const value = m.value2 ? `${primary}/${formatObservationValue(m.value2, concept)}` : primary;
  // The API sends the UCUM code ("mm[Hg]"); people read "mmHg".
  const unit = displayUnit(concept, m.unit);
  return unit ? `${value} ${unit}` : value;
}
