/** Display helpers. Dates are shown in the viewer's zone; the API receives ISO strings. */

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "Ravi K., born 1960, male" — the label the patient chose to share, nothing more. */
export function patientLabel(p: { displayName: string; yearOfBirth: number | null; sex: string | null } | undefined): string {
  if (!p) return "Patient";
  const parts = [p.displayName];
  if (p.yearOfBirth) parts.push(`born ${p.yearOfBirth}`);
  if (p.sex) parts.push(p.sex);
  return parts.join(" · ");
}

/** A `<input type="date">` value → ISO date-time at local midnight; empty → undefined. */
export function dateInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** A `<input type="datetime-local">` value → ISO; empty → undefined. */
export function dateTimeInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function todayInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
