// Calendar helpers: Google Calendar links, .ics files (Apple Calendar, Outlook)
// and the subscribable feed. Reminders are VALARMs, so phones notify people.
import { PARTS, parseRange } from "./time";
import type { Booking } from "./types";

export const CENTRE_ADDRESS = "the*spark Pullur Centre, ITPL Main Rd, Whitefield, Bengaluru";

export type CalEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  location: string;
  description: string;
  url?: string;
  cancelled?: boolean;
};

export function bookingToEvent(b: Booking, resourceName: string, appUrl?: string): CalEvent {
  const { start, end } = parseRange(b.slot);
  const isDesk = b.kind === "desk";
  const part = PARTS.find((p) => p.id === b.part);
  return {
    uid: `${b.id}@thespark-booking`,
    title: isDesk ? `Desk ${b.resource_id} · the*spark` : `${resourceName} · the*spark`,
    start: new Date(start),
    end: new Date(end),
    location: CENTRE_ADDRESS,
    description: [
      isDesk ? `Seat ${b.resource_id}, ${part?.label ?? ""} (${part?.time ?? ""})` : resourceName,
      "Check in from My bookings when you arrive.",
      appUrl ? `${appUrl}/me` : "",
    ].filter(Boolean).join("\n"),
    url: appUrl ? `${appUrl}/me` : undefined,
    cancelled: b.status === "cancelled",
  };
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleCalendarUrl(ev: CalEvent): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${stamp(ev.start)}/${stamp(ev.end)}`,
    details: ev.description,
    location: ev.location,
    ctz: "Asia/Kolkata",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets must be folded (RFC 5545). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curLen = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (curLen + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      curLen = 0;
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Builds an .ics calendar. Each event gets reminders 1 day, 1 hour and 15 minutes before. */
export function buildIcs(events: CalEvent[], name = "the*spark bookings"): string {
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//the*spark Pullur Centre//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(ev.start)}`,
      `DTEND:${stamp(ev.end)}`,
      `SUMMARY:${esc(ev.title)}`,
      `LOCATION:${esc(ev.location)}`,
      `DESCRIPTION:${esc(ev.description)}`,
      ...(ev.url ? [`URL:${ev.url}`] : []),
      `STATUS:${ev.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    );
    if (!ev.cancelled) {
      for (const [trigger, text] of [["-P1D", "Tomorrow"], ["-PT1H", "In 1 hour"], ["-PT15M", "In 15 minutes"]]) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${esc(`${text}: ${ev.title}`)}`, "END:VALARM");
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Browser: download a single booking as .ics (opens Apple Calendar on iPhone/Mac). */
export function downloadIcs(ev: CalEvent, filename = "the-spark-booking.ics") {
  const blob = new Blob([buildIcs([ev], ev.title)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
