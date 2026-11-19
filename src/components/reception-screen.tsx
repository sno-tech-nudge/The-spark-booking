"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { SparkMark, Spinner, Wordmark } from "./brand";
import { useAnnouncements, dateRange } from "./announcements";
import { useCatalog, useClock, useLiveOccupancy, useMounted } from "@/lib/hooks";
import { closedOn } from "@/lib/announcements";
import { publicOrigin } from "@/lib/site";
import { supabaseConfigured } from "@/lib/supabase/client";
import { fmtHour, istHour, todayIST } from "@/lib/time";
import type { Occupancy } from "@/lib/types";

const TZ = "Asia/Kolkata";

/** Which desk session is on now (or next), in IST hours. */
function currentSession(h: number, sunday: boolean) {
  if (sunday) return { label: "Closed today", open: false, start: 0, end: 0 };
  if (h < 13.5) return { label: h < 9 ? "Morning session · opens 9am" : "Morning session · until 1:30pm", open: true, start: 9, end: 13.5 };
  if (h < 18) return { label: "Afternoon session · until 6pm", open: true, start: 13.5, end: 18 };
  return { label: "Closed for the day · see you at 9am", open: false, start: 0, end: 0 };
}

/**
 * Full-screen board for the TV at the entrance. No sign-in, nothing private:
 * only counts, room status and notices, all from the public occupancy feed.
 */
export function ReceptionScreen() {
  const mounted = useMounted();
  const now = useClock(1000);
  const today = mounted ? todayIST() : null;
  const { catalog } = useCatalog();
  const { occupancy, live } = useLiveOccupancy(today);
  const { announcements } = useAnnouncements();
  const [qr, setQr] = useState<string>("");
  const [chrome, setChrome] = useState(true);
  const bookUrl = mounted ? `${publicOrigin()}/book` : "";

  // QR for "scan to book"
  useEffect(() => {
    if (!bookUrl) return;
    QRCode.toString(bookUrl, { type: "svg", margin: 0, color: { dark: "#101010", light: "#ffffff" } }).then(setQr).catch(() => {});
  }, [bookUrl]);

  // keep the TV awake, reload every 6h to pick up new versions, hide the cursor when idle
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    let lock: Sentinel | null = null;
    const wake = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock?.request("screen") ?? null;
      } catch { /* not supported */ }
    };
    wake();
    const onVis = () => document.visibilityState === "visible" && wake();
    document.addEventListener("visibilitychange", onVis);
    const reload = setTimeout(() => window.location.reload(), 6 * 3600_000);
    let idle: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setChrome(true);
      clearTimeout(idle);
      idle = setTimeout(() => setChrome(false), 4000);
    };
    onMove();
    window.addEventListener("mousemove", onMove);
    return () => {
      lock?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("mousemove", onMove);
      clearTimeout(reload);
      clearTimeout(idle);
    };
  }, []);

  const desks = useMemo(() => catalog?.resources.filter((r) => r.kind === "desk") ?? [], [catalog]);
  const rooms = useMemo(() => catalog?.resources.filter((r) => r.kind === "room") ?? [], [catalog]);
  const closed = useMemo(() => closedOn(announcements, today, catalog?.resources ?? []), [announcements, today, catalog]);

  if (!supabaseConfigured || !now || !catalog || !today) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink">
        <Spinner className="h-16 w-16" />
      </div>
    );
  }

  const t = now.getTime();
  const h = istHour(now.toISOString());
  const sunday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now) === "Sun";
  const session = currentSession(h, sunday);

  // a desk is taken for this session if any live booking overlaps the session window
  const sessStart = new Date(`${today}T00:00:00+05:30`).getTime() + session.start * 3600_000;
  const sessEnd = new Date(`${today}T00:00:00+05:30`).getTime() + session.end * 3600_000;
  const overlapsSession = (o: Occupancy) => new Date(o.start_at).getTime() < sessEnd && new Date(o.end_at).getTime() > sessStart;
  const takenDesks = new Set(occupancy.filter((o) => o.kind !== "room" && overlapsSession(o)).map((o) => o.resource_id));
  const freeDesk = (id: string) => !takenDesks.has(id) && !closed.has(id);
  const assigned = new Set(desks.filter((d) => d.assigned_membership).map((d) => d.id));
  const freeTotal = session.open ? desks.filter((d) => freeDesk(d.id) && !assigned.has(d.id)).length : 0;
  const zones = [...new Set(desks.map((d) => d.zone!))];

  const roomRows = rooms.map((r) => {
    const mine = occupancy
      .filter((o) => o.resource_id === r.id)
      .map((o) => ({ s: new Date(o.start_at).getTime(), e: new Date(o.end_at).getTime(), o }))
      .sort((a, b) => a.s - b.s);
    const cur = mine.find((x) => x.s <= t && t < x.e);
    const nxt = mine.find((x) => x.s > t);
    let status: { text: string; tone: "free" | "busy" | "closed" };
    if (closed.has(r.id) || cur?.o.kind === "block") status = { text: "Closed today", tone: "closed" };
    else if (cur) status = { text: `In use · until ${fmtHour(istHour(cur.o.end_at) || 24)}`, tone: "busy" };
    else if (nxt) status = { text: `Free · until ${fmtHour(istHour(nxt.o.start_at))}`, tone: "free" };
    else status = { text: "Free", tone: "free" };
    return { r, status };
  });
  const roomsFree = roomRows.filter((x) => x.status.tone === "free").length;

  const notices = announcements.filter((a) => a.ends_on >= today).slice(0, 3);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-ink p-[2.5vmin] text-paper" style={{ cursor: chrome ? "default" : "none" }}>
      <SparkMark className="pointer-events-none absolute -bottom-[18vmin] -right-[18vmin] h-[70vmin] w-[70vmin] text-spark/[0.06] spark-spin [animation-duration:60s]" />

      {/* header */}
      <header className="relative flex items-start justify-between gap-6">
        <span className="text-[6vmin]"><Wordmark tone="dark" sub /></span>
        <div className="text-right">
          <p className="font-light tabular-nums leading-none text-[10vmin]">
            {new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now)}
          </p>
          <p className="mt-[1vmin] font-serif italic text-spark text-[2.4vmin]">
            {new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(now)}
          </p>
          <p className="mt-[0.6vmin] uppercase tracking-[0.18em] text-paper/55 text-[1.5vmin]">{session.label}</p>
        </div>
      </header>

      <main className="relative mt-[2vmin] grid min-h-0 flex-1 grid-cols-[1.25fr_1fr] gap-[2.5vmin]">
        {/* desks */}
        <section className="flex min-h-0 flex-col rounded-[2.5vmin] bg-paper/[0.04] p-[2.5vmin] ring-1 ring-paper/10">
          <p className="uppercase tracking-[0.2em] text-paper/55 text-[1.6vmin]">Seats free {session.open ? "this session" : ""}</p>
          <div className="mt-[1vmin] flex items-end gap-[2vmin]">
            <span className="font-light tabular-nums leading-none text-spark text-[19vmin]">{session.open ? freeTotal : "—"}</span>
            <span className="mb-[3vmin] text-paper/55 text-[3vmin]">of {desks.length}</span>
          </div>
          <div className="mt-auto grid grid-cols-4 gap-[2vmin]">
            {zones.map((z) => {
              const zd = desks.filter((d) => d.zone === z);
              const zoneClosed = zd.every((d) => closed.has(d.id));
              const free = session.open ? zd.filter((d) => freeDesk(d.id) && !assigned.has(d.id)).length : 0;
              return (
                <div key={z} className={`rounded-[2vmin] p-[2vmin] ${zoneClosed ? "bg-paper/5" : "bg-paper/[0.07]"}`}>
                  <p className="uppercase tracking-[0.18em] text-paper/55 text-[1.5vmin]">Zone <span className="text-spark">{z}</span></p>
                  {zoneClosed ? (
                    <p className="mt-[1vmin] text-paper/70 text-[2.2vmin]">Closed today</p>
                  ) : (
                    <>
                      <p className="mt-[0.5vmin] font-light tabular-nums leading-none text-[7vmin]">{session.open ? free : "—"}</p>
                      <div className="mt-[1.2vmin] h-[0.8vmin] overflow-hidden rounded-full bg-paper/10">
                        <div className="h-full rounded-full bg-spark transition-[width] duration-700" style={{ width: `${(free / zd.length) * 100}%` }} />
                      </div>
                      <p className="mt-[0.6vmin] text-paper/45 text-[1.4vmin]">free of {zd.length}</p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* rooms */}
        <section className="flex min-h-0 flex-col rounded-[2.5vmin] bg-paper/[0.04] p-[2.5vmin] ring-1 ring-paper/10">
          <p className="uppercase tracking-[0.2em] text-paper/55 text-[1.6vmin]">Rooms free now · <span className="text-spark">{roomsFree}</span> of {rooms.length}</p>
          <ul className="mt-[1vmin] flex min-h-0 flex-1 flex-col justify-between overflow-hidden">
            {roomRows.map(({ r, status }) => (
              <li key={r.id} className="flex items-center justify-between gap-[2vmin] border-b border-paper/10 py-[0.45vmin] last:border-0">
                <span className="truncate text-[1.9vmin]">{r.name}</span>
                <span className={`shrink-0 rounded-full px-[1.4vmin] py-[0.25vmin] text-[1.6vmin] ${
                  status.tone === "busy" ? "bg-spark text-ink" : status.tone === "closed" ? "bg-paper/10 text-paper/50" : "text-spark ring-1 ring-spark/60"
                }`}>{status.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* notices + scan to book */}
      <footer className="relative mt-[2vmin] flex shrink-0 items-center gap-[3vmin]">
        <div className="min-w-0 flex-1 space-y-[1vmin]">
          {notices.length ? notices.map((a) => (
            <p key={a.id} className="flex items-center gap-[1.5vmin] text-[2.4vmin]">
              <SparkMark className="h-[2.6vmin] w-[2.6vmin] shrink-0 text-spark" />
              <span className="truncate">{a.message}</span>
              <span className="shrink-0 text-paper/45 text-[1.8vmin]">{a.starts_on <= today && a.starts_on === a.ends_on ? "Today" : dateRange(a)}</span>
            </p>
          )) : (
            <p className="font-serif italic text-paper/60 text-[2.6vmin]">connect · collaborate · change</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-[2vmin] rounded-[2vmin] bg-paper p-[1.5vmin] text-ink">
          <div className="h-[11vmin] w-[11vmin] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
          <div className="pr-[1vmin]">
            <p className="uppercase tracking-[0.16em] text-ink/55 text-[1.4vmin]">Scan to book</p>
            <p className="font-medium text-[2.4vmin]">a seat or room</p>
            <p className="text-ink/50 text-[1.4vmin]">{bookUrl.replace(/^https?:\/\//, "")}</p>
          </div>
        </div>
      </footer>

      {/* controls (fade away when idle) */}
      <div className={`absolute left-1/2 top-[2vmin] flex -translate-x-1/2 items-center gap-2 transition-opacity ${chrome ? "opacity-100" : "opacity-0"}`}>
        <span className="flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1 text-xs text-paper/70">
          <span className={`h-2 w-2 rounded-full ${live === "live" ? "bg-spark live-dot" : "bg-red-500"}`} />
          {live === "live" ? "Live" : "Reconnecting…"}
        </span>
        <button
          className="rounded-full bg-paper/10 px-3 py-1 text-xs text-paper/80 hover:bg-paper/20"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
        >
          Full screen
        </button>
      </div>
    </div>
  );
}
