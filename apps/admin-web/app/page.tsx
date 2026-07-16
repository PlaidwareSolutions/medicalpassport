/**
 * Clinical & administrative portal shell (docs/12 §8.3).
 *
 * Stage 2 status: authenticated admin features (catalog maker-checker,
 * content review, rule management, audit review) land in Stages 2b–8.
 * Admin authentication is intentionally stronger than patient auth
 * (email + password + TOTP MFA, optional Cloudflare Access) — docs/18.
 */
export default function AdminHome() {
  const areas = [
    ["Medication catalog", "Brands, ingredients, combinations — maker-checker approval"],
    ["Clinical content", "Patient education, missed-dose guidance, warning symptoms"],
    ["Translations", "hi / te / ur review queues with clinical sign-off"],
    ["Safety rules", "Rule versions, review status, re-evaluation triggers"],
    ["Incidents & audit", "Audit search (itself audited), incident review"],
    ["Operations", "Job replay, DLQ, reports"],
  ] as const;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-xl) var(--space-md)" }}>
      <h1 style={{ color: "var(--color-text)" }}>Clinical Administration</h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        Internal portal — requires administrator sign-in (coming with the catalog workflows).
      </p>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "var(--space-sm)" }}>
        {areas.map(([title, desc]) => (
          <li
            key={title}
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "var(--space-md)",
            }}
          >
            <strong style={{ color: "var(--color-text)" }}>{title}</strong>
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{desc}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
