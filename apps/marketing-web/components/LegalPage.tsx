import type { ReactNode } from "react";

/**
 * Shell for the draft legal pages (/privacy/, /terms/). Session 12.
 *
 * Deliberately carries a prominent, unmissable DRAFT banner: these documents
 * are NOT counsel-approved and must not read as production-final. The exact
 * marker string "DRAFT — LEGAL REVIEW REQUIRED" is also what the production
 * build guard (scripts/check-legal-placeholders.mjs) scans for, so a real
 * production build cannot ship an unreviewed page. Keep that string intact.
 *
 * Placeholders like [LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH] are
 * intentional and reviewer-visible; the same guard blocks them from a
 * production build. Staging (MARKETING_ENV=staging) allows them.
 */
export type LegalSection = { id: string; title: string };

const DRAFT_MARKER = "DRAFT — LEGAL REVIEW REQUIRED";

export function LegalPage({
  title,
  intro,
  sections,
  children,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  children: ReactNode;
}) {
  return (
    <section className="mkt-section">
      <div className="mkt-container-text">
        {/* Unmissable draft status */}
        <div
          role="note"
          aria-label="Document status"
          style={{
            border: "2px solid var(--mkt-ill-clay)",
            background: "var(--mkt-ill-sand)",
            color: "var(--mkt-ink)",
            borderRadius: "var(--mkt-radius-frame)",
            padding: "16px 18px",
            marginBottom: "28px",
          }}
        >
          <strong style={{ display: "block", fontSize: "1rem", letterSpacing: "0.01em" }}>
            {DRAFT_MARKER}
          </strong>
          <span style={{ fontSize: "0.9375rem" }}>
            This is a working draft, under legal review. It is not a final or legally binding document,
            and does not represent legal advice or a statement of compliance. Wording, placeholders, and
            commitments may change before launch.
          </span>
        </div>

        <h1 style={{ marginBottom: "6px" }}>{title}</h1>
        <p className="mkt-muted" style={{ fontSize: "0.9375rem", marginBottom: "20px" }}>
          Status: <strong>Draft — under legal review</strong> · Last updated 2026-08-12 ·
          Operator: [LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH]
        </p>

        <p className="mkt-p" style={{ marginBottom: "24px" }}>{intro}</p>

        {/* Contents — real anchor links, not collapsed accordions */}
        <nav aria-label="On this page" style={{ marginBottom: "32px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "10px" }}>On this page</h2>
          <ul style={{ display: "grid", gap: "6px", paddingLeft: "1.1em" }}>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mkt-legal-body" style={{ display: "grid", gap: "28px" }}>
          {children}
        </div>
      </div>
    </section>
  );
}

export function LegalSectionBlock({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={{ fontSize: "1.35rem", marginBottom: "10px" }}>
        {title}
      </h2>
      <div style={{ display: "grid", gap: "12px" }}>{children}</div>
    </section>
  );
}
