/**
 * Date detection for printed Indian documents. Day-first numeric dates (dd/mm/yyyy, dd-mm-yy,
 * dd.mm.yyyy), "12 Aug 2026" / "12th August, 2026" / "Aug 12, 2026", and ISO dates.
 * Output is always `YYYY-MM-DD`; anything that is not a real calendar date is skipped.
 */
export interface DateMatch {
  iso: string;
  start: number;
  end: number;
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const NUMERIC_DMY = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;
const TEXT_DMY = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})\b/g;
const TEXT_MDY = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;

export function toIsoDate(year: number, month: number, day: number): string | null {
  const y = year < 100 ? 2000 + year : year;
  if (y < 1900 || y > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(y, month - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function findDates(text: string): DateMatch[] {
  const found: DateMatch[] = [];
  const overlaps = (start: number, end: number) => found.some((f) => start < f.end && end > f.start);
  const push = (m: RegExpExecArray, iso: string | null) => {
    const start = m.index;
    const end = m.index + m[0].length;
    if (iso && !overlaps(start, end)) found.push({ iso, start, end, raw: m[0] });
  };

  for (const m of text.matchAll(ISO)) push(m, toIsoDate(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(TEXT_DMY)) {
    const month = MONTHS[(m[2] ?? "").toLowerCase()];
    if (month) push(m, toIsoDate(Number(m[3]), month, Number(m[1])));
  }
  for (const m of text.matchAll(TEXT_MDY)) {
    const month = MONTHS[(m[1] ?? "").toLowerCase()];
    if (month) push(m, toIsoDate(Number(m[3]), month, Number(m[2])));
  }
  for (const m of text.matchAll(NUMERIC_DMY)) push(m, toIsoDate(Number(m[3]), Number(m[2]), Number(m[1])));

  return found.sort((a, b) => a.start - b.start);
}
