"use client";

import { useEffect, useState } from "react";
import { bookingToEvent, downloadIcs, googleCalendarUrl } from "@/lib/calendar";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Booking } from "@/lib/types";
import { Spinner } from "./brand";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#4285F4" strokeWidth="1.6" />
      <path d="M3 9h18" stroke="#4285F4" strokeWidth="1.6" />
      <text x="12" y="18.2" textAnchor="middle" fontSize="8" fontWeight="700" fill="#34A853" fontFamily="Arial">31</text>
    </svg>
  );
}
function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#101010" strokeWidth="1.6" />
      <rect x="3" y="4" width="18" height="5" rx="2" fill="#ff3b30" />
      <text x="12" y="18.2" textAnchor="middle" fontSize="8" fontWeight="600" fill="#101010" fontFamily="Arial">31</text>
    </svg>
  );
}

/** "Add to Google / Apple Calendar" for one booking. */
export function AddToCalendar({ booking, resourceName, compact = false }: { booking: Booking; resourceName: string; compact?: boolean }) {
  const ev = () => bookingToEvent(booking, resourceName, window.location.origin);
  const cls = compact
    ? "inline-flex items-center gap-1.5 rounded-full border border-sand bg-white px-2.5 py-1 text-xs hover:border-ink"
    : "btn-ghost flex-1";
  return (
    <div className={`flex ${compact ? "gap-1.5" : "gap-2"}`}>
      <button className={cls} onClick={() => window.open(googleCalendarUrl(ev()), "_blank", "noopener")}>
        <GoogleIcon /> {compact ? "Google" : "Google Calendar"}
      </button>
      <button className={cls} onClick={() => downloadIcs(ev(), `the-spark-${booking.resource_id}-${booking.booking_date}.ics`)}>
        <AppleIcon /> {compact ? "Apple" : "Apple / Outlook"}
      </button>
    </div>
  );
}

/** Subscribe once; every booking (and cancellation) shows up in the phone's calendar with reminders. */
export function CalendarSync() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async (reset = false) => {
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("my_calendar_token", { p_reset: reset });
    setToken((data as string) ?? null);
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  const host = typeof window === "undefined" ? "" : window.location.host;
  const https = token ? `https://${host}/api/calendar/${token}` : "";
  const webcal = token ? `webcal://${host}/api/calendar/${token}` : "";

  return (
    <div className="card p-5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">Calendar sync</p>
      <p className="mt-1 font-medium">Get bookings & reminders on your phone</p>
      <p className="mt-1 text-sm text-ink/60">
        Subscribe once — new bookings, room meetings and cancellations appear automatically, with reminders a day, an hour and 15 minutes before.
      </p>
      {!token ? (
        <div className="mt-4 flex justify-center py-2"><Spinner /></div>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost" href={webcal}><AppleIcon /> Apple Calendar</a>
            <a className="btn-ghost" target="_blank" rel="noopener" href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`}>
              <GoogleIcon /> Google Calendar
            </a>
            <button
              className="btn-ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(https);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          </div>
          <p className="text-xs text-ink/50">
            Keep this link private — anyone with it can see your bookings.{" "}
            <button className="underline" disabled={busy} onClick={() => confirm("Make a new link? The old one stops working.") && load(true)}>
              Reset link
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
