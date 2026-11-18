// All times are the centre's local time (IST, UTC+05:30, no daylight saving).
import type { Part } from "./types";

const IST_OFFSET_MIN = 330;

export function istNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + (IST_OFFSET_MIN + now.getTimezoneOffset()) * 60_000);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayIST(): string {
  return toISODate(istNow());
}

/** Open days (Mon–Sat) starting today. */
export function openDays(count: number): { date: string; dow: string; day: string; month: string }[] {
  const out: { date: string; dow: string; day: string; month: string }[] = [];
  const d = istNow();
  d.setHours(12, 0, 0, 0);
  while (out.length < count) {
    if (d.getDay() !== 0) {
      out.push({
        date: toISODate(d),
        dow: d.toLocaleDateString("en-IN", { weekday: "short" }),
        day: String(d.getDate()),
        month: d.toLocaleDateString("en-IN", { month: "short" }),
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** ISO timestamp for a local IST date + hour, e.g. 2026-11-19 + 10 → 2026-11-19T10:00:00+05:30 */
export function istTimestamp(date: string, hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`;
}

/** Hour of day (IST, fractional) for an ISO timestamp. */
export function istHour(iso: string): number {
  const d = new Date(iso);
  const mins = (d.getUTCHours() * 60 + d.getUTCMinutes() + IST_OFFSET_MIN) % (24 * 60);
  return mins / 60;
}

export function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const suffix = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${suffix}` : `${h12}${suffix}`;
}

export function fmtDate(date: string): string {
  const d = new Date(`${date}T12:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

export const PARTS: { id: Part; label: string; time: string; start: number; end: number }[] = [
  { id: "morning", label: "Morning", time: "9am – 1:30pm", start: 9, end: 13.5 },
  { id: "afternoon", label: "Afternoon", time: "1:30 – 6pm", start: 13.5, end: 18 },
  { id: "full", label: "Full day", time: "9am – 6pm", start: 9, end: 18 },
];

export function partsOverlap(a: Part, b: Part): boolean {
  return a === "full" || b === "full" || a === b;
}

/** Parse a Postgres tstzrange string like ["2026-11-19 03:30:00+00","2026-11-19 12:30:00+00") */
export function parseRange(r: string): { start: string; end: string } {
  const m = r.match(/^[[(]"?([^",]+)"?,"?([^")\]]+)"?[)\]]$/);
  if (!m) return { start: r, end: r };
  const fix = (s: string) => s.replace(" ", "T").replace(/\+00$/, "Z").replace(/([+-]\d\d)$/, "$1:00");
  return { start: fix(m[1]), end: fix(m[2]) };
}

export function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
