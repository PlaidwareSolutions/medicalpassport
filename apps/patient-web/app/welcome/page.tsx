"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@medpass/localization";
import { Button, Card } from "@medpass/ui-web";
import { useI18n } from "../../lib/i18n";

/** Screens 1–2: Welcome + language selection (docs/07). Public, zero-install. */
export default function WelcomePage() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "var(--space-xl) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-lg)", minHeight: "100dvh", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div aria-hidden="true" style={{ fontSize: "3rem" }}>💊</div>
        <h1 style={{ fontSize: "var(--font-title)", margin: "var(--space-sm) 0" }}>{t("app.name")}</h1>
        <p style={{ color: "var(--color-text-muted)", margin: 0 }}>{t("app.tagline")}</p>
      </div>

      <Card>
        <strong>{t("welcome.choose_language")}</strong>
        <div role="radiogroup" aria-label={t("welcome.choose_language")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--size-touch-gap)" }}>
          {SUPPORTED_LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === locale}
              onClick={() => setLocale(l)}
              style={{
                minHeight: "var(--size-touch)",
                borderRadius: "var(--radius-sm)",
                border: `2px solid ${l === locale ? "var(--color-primary)" : "var(--color-border)"}`,
                background: l === locale ? "var(--color-primary-soft)" : "var(--color-bg)",
                fontSize: "var(--font-large)",
                fontFamily: "var(--font-family)",
                cursor: "pointer",
              }}
            >
              {LOCALE_NAMES[l]}
            </button>
          ))}
        </div>
      </Card>

      <Button fullWidth onClick={() => router.push("/login")}>
        {t("welcome.get_started")}
      </Button>

      {/* Screen 1 secondary action: the public tour — a warm look at what
          the app does before asking anyone to sign in. Help itself stays
          reachable from Profile and from the tour's destination screens. */}
      <Link href="/tour">
        <Button variant="secondary" fullWidth>
          {t("welcome.take_tour")}
        </Button>
      </Link>

      <p style={{ textAlign: "center", fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
        {t("app.not_a_doctor")}
      </p>
    </main>
  );
}
