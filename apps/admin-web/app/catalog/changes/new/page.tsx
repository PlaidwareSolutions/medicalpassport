"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, SectionTitle, TextInput } from "@medpass/ui-web";
import { AdminShell } from "../../../../components/AdminShell";
import { api } from "../../../../lib/api";

type EntityType = "ingredient" | "manufacturer" | "brand" | "dosage_form" | "route" | "product" | "classification";
type Operation = "create" | "update" | "deprecate";

function NewChangeForm() {
  const router = useRouter();
  const params = useSearchParams();
  const entityType = (params.get("entityType") as EntityType) ?? "ingredient";
  const operation = (params.get("operation") as Operation) ?? "create";
  const entityId = params.get("entityId") ?? undefined;

  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function set(key: string, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function buildProposedData(): Record<string, unknown> {
    switch (entityType) {
      case "ingredient":
        return { name: fields.name, synonyms: fields.synonyms ? fields.synonyms.split(",").map((s) => s.trim()) : undefined };
      case "manufacturer":
        return { name: fields.name };
      case "brand":
        return { name: fields.name, manufacturerId: fields.manufacturerId || undefined };
      case "dosage_form":
      case "route":
        return { name: fields.name };
      case "classification":
        return { name: fields.name, parentId: fields.parentId || undefined };
      case "product":
        return {
          genericName: fields.genericName,
          brandId: fields.brandId || undefined,
          dosageFormId: fields.dosageFormId || undefined,
          routeId: fields.routeId || undefined,
          strengthLabel: fields.strengthLabel || undefined,
          isCombination: fields.isCombination === "true",
        };
    }
  }

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        entityType,
        operation,
        entityId,
        proposedData: operation === "deprecate" ? {} : buildProposedData(),
      };
      const res = await api.post<{ id: string }>("/admin/catalog-changes", body);
      router.replace(`/catalog/changes/${res.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 style={{ fontSize: "var(--font-title)" }}>
        Propose: {operation} {entityType}
      </h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {entityId ? <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>Target entity: {entityId}</p> : null}

      {operation === "deprecate" ? (
        <Banner tone="warning">This will mark the entity as deprecated once approved. No further fields needed.</Banner>
      ) : (
        <>
          <SectionTitle>Fields</SectionTitle>
          {entityType === "ingredient" ? (
            <>
              <TextInput label="Name" value={fields.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              <TextInput label="Synonyms (comma-separated)" value={fields.synonyms ?? ""} onChange={(e) => set("synonyms", e.target.value)} />
            </>
          ) : null}
          {entityType === "manufacturer" ? <TextInput label="Name" value={fields.name ?? ""} onChange={(e) => set("name", e.target.value)} /> : null}
          {entityType === "brand" ? (
            <>
              <TextInput label="Name" value={fields.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              <TextInput label="Manufacturer ID (optional)" value={fields.manufacturerId ?? ""} onChange={(e) => set("manufacturerId", e.target.value)} />
            </>
          ) : null}
          {entityType === "dosage_form" || entityType === "route" ? (
            <TextInput label="Name" value={fields.name ?? ""} onChange={(e) => set("name", e.target.value)} />
          ) : null}
          {entityType === "classification" ? (
            <>
              <TextInput label="Name" value={fields.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              <TextInput label="Parent class ID (optional)" value={fields.parentId ?? ""} onChange={(e) => set("parentId", e.target.value)} />
            </>
          ) : null}
          {entityType === "product" ? (
            <>
              <TextInput label="Generic name" value={fields.genericName ?? ""} onChange={(e) => set("genericName", e.target.value)} />
              <TextInput label="Brand ID (optional)" value={fields.brandId ?? ""} onChange={(e) => set("brandId", e.target.value)} />
              <TextInput label="Dosage form ID (optional)" value={fields.dosageFormId ?? ""} onChange={(e) => set("dosageFormId", e.target.value)} />
              <TextInput label="Route ID (optional)" value={fields.routeId ?? ""} onChange={(e) => set("routeId", e.target.value)} />
              <TextInput label="Strength label (optional)" value={fields.strengthLabel ?? ""} onChange={(e) => set("strengthLabel", e.target.value)} />
            </>
          ) : null}
        </>
      )}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Button fullWidth disabled={busy} onClick={() => void submit()}>
          Submit proposal
        </Button>
      </div>
    </AdminShell>
  );
}

export default function NewCatalogChangePage() {
  return (
    <Suspense>
      <NewChangeForm />
    </Suspense>
  );
}
