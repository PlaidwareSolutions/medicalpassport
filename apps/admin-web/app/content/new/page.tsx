"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, SectionTitle, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../../components/AdminShell";
import { api } from "../../../lib/api";

const KIND_OPTIONS = [
  { value: "education", label: "Commonly used for" },
  { value: "storage", label: "Storage" },
  { value: "warning_symptoms", label: "Warning symptoms" },
  { value: "food_alcohol", label: "Food & alcohol" },
  { value: "missed_dose", label: "Missed dose" },
] as const;

/**
 * Manual authoring path — for (ingredient, kind) pairs the automated
 * openFDA pipeline had no reliable match for. Still goes through the same
 * review gate as a system-drafted version, except maker != checker is
 * enforced here (a human proposed it, unlike a system draft with no
 * "maker" to conflict with).
 */
export default function NewContentPage() {
  const router = useRouter();
  const [ingredientId, setIngredientId] = useState("");
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]["value"]>("education");
  const [body, setBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.post<{ contentId: string }>("/admin/content", {
        ingredientId,
        kind,
        body,
        sourceUrl: sourceUrl || undefined,
      });
      router.replace(`/content/${res.contentId}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>Propose content manually</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Banner tone="info">Use this only when the automated pipeline found no reliable match. This still requires a second reviewer's approval before anything reaches a patient.</Banner>

      <SectionTitle>Fields</SectionTitle>
      <TextInput label="Ingredient ID" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} />
      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <span>Kind</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof KIND_OPTIONS)[number]["value"])}
          style={{
            padding: "var(--space-sm)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            font: "inherit",
          }}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <span>Content text</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          style={{
            padding: "var(--space-sm)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            font: "inherit",
          }}
        />
      </label>
      <TextInput label="Source URL (optional)" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Button fullWidth disabled={busy || !ingredientId || !body} onClick={() => void submit()}>
          Submit proposal
        </Button>
      </div>
    </AdminShell>
  );
}
