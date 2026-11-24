"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";
import { CornerSpark, PageHeader, SparkMark } from "./brand";
import { AddToCalendar } from "./calendar-actions";
import { Loader, LiveBadge, Toast, useToast } from "./ui";
import { NotConfigured } from "./book-seat";
import { useCatalog, useClock, useLiveOccupancy, useMounted } from "@/lib/hooks";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { closedOn } from "@/lib/announcements";
import { useAnnouncements } from "./announcements";
import { BusyNudge, PullToRefresh } from "./nudges";
import { EventRow, useEvents, useMyRsvps } from "./events";
import { buzz } from "@/lib/haptics";
import { PARTS, fmtDate, fmtHour, istHour, parseRange, todayIST } from "@/lib/time";
import type { Booking, Occupancy, Resource } from "@/lib/types";

const TZ = "Asia/Kolkata";
const REFRESH_EVENT = "spark:refresh";

function slotLabel(h: number, dow: number) {
  if (dow === 0) return "Closed today (Sunday)";
  if (h < 9) return `Opens at 9am`;
  if (h < 13.5) return "Morning session · 9am – 1:30pm";
  if (h < 18) return "Afternoon session · 1:30 – 6pm";
  if (h < 22) return "After hours · members' rooms till 10pm";
  return "Closed for the night";
}

export function fmtDuration(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---------------------------------------------------------------------------
// Your ongoing / next booking, as a ticket

export function OngoingTicket({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const now = useClock(1000);
  const { catalog } = useCatalog();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabaseBrowser()
      .from("bookings").select("*").eq("user_id", user.id).eq("status", "confirmed").in("kind", ["desk", "room"])
      .gte("booking_date", todayIST()).order("slot").limit(30);
    setBookings((data as Booking[]) ?? []);
  }, [user]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [load]);

  if (!user || !now || bookings === null) return null;
  const t = now.getTime();
  const withTimes = bookings.map((b) => {
    const r = parseRange(b.slot);
    return { b, start: new Date(r.start).getTime(), end: new Date(r.end).getTime() };
  });
  const current = withTimes.find((x) => x.start <= t && t < x.end);
  const next = withTimes.find((x) => x.start > t);
  const item = current ?? next;
  if (!item) {
    return compact ? null : (
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-ink/60">Nothing booked right now.</p>
        <Link href="/book" className="btn-spark text-sm">Book a seat</Link>
      </div>
    );
  }

  const { b, start, end } = item;
  const ongoing = item === current;
  const name = b.kind === "desk" ? `Seat ${b.resource_id}` : catalog?.resources.find((r) => r.id === b.resource_id)?.name ?? b.resource_id;
  const timeRange = b.kind === "desk"
    ? PARTS.find((p) => p.id === b.part)?.time
    : `${fmtHour(istHour(new Date(start).toISOString()))} – ${fmtHour(istHour(new Date(end).toISOString()) || 24)}`;
  const pct = ongoing ? Math.min(100, ((t - start) / (end - start)) * 100) : 0;
  const isToday = b.booking_date === todayIST();

  async function checkIn() {
    const { error } = await supabaseBrowser().rpc("check_in", { p_id: b.id });
    if (error) return show(friendlyError(error), "error");
    show("Checked in — welcome to the*spark!");
    buzz();
    load();
  }

  return (
    <div className="relative flex overflow-hidden rounded-2xl border border-sand bg-white shadow-sm">
      {/* ticket stub */}
      <div className={`relative flex w-24 shrink-0 flex-col items-center justify-center gap-1 ${ongoing ? "bg-spark" : "bg-ink text-paper"} p-3 text-center`}>
        <SparkMark className={`h-6 w-6 ${ongoing ? "text-white spark-spin" : "text-spark"}`} />
        <span className="text-[10px] uppercase tracking-[0.14em]">{ongoing ? "Now" : isToday ? "Today" : "Next"}</span>
        <span className="text-xs font-medium">{fmtDate(b.booking_date).split(",")[0]}</span>
        <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-paper" />
      </div>
      <div className="min-w-0 flex-1 border-l-2 border-dashed border-sand p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">{ongoing ? "Happening now" : "Up next"}</p>
            <p className="text-xl font-light">{name}</p>
            <p className="text-sm text-ink/60">{fmtDate(b.booking_date)} · {timeRange}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-light tabular-nums">{ongoing ? fmtDuration(end - t) : fmtDuration(start - t)}</p>
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">{ongoing ? "left" : "to go"}</p>
          </div>
        </div>
        {ongoing && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream">
            <div className="h-full rounded-full bg-spark transition-[width] duration-1000" style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isToday && !b.checked_in_at && <button className="btn-ink !py-1.5 text-sm" onClick={checkIn}>Check in</button>}
          {b.checked_in_at && <span className="chip bg-ink text-spark">Checked in</span>}
          {!compact && <AddToCalendar booking={b} resourceName={name} compact />}
        </div>
      </div>
      <Toast toast={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The live board

export function NowBoard() {
  const mounted = useMounted();
  const now = useClock(1000);
  const today = mounted ? todayIST() : null;
  const { catalog } = useCatalog();
  const { occupancy, live, reload } = useLiveOccupancy(today);
  const { user } = useAuth();
  const { announcements, reload: reloadNotices } = useAnnouncements();

  const rooms = useMemo(() => catalog?.resources.filter((r) => r.kind === "room") ?? [], [catalog]);
  const desks = useMemo(() => catalog?.resources.filter((r) => r.kind === "desk") ?? [], [catalog]);
  const closedToday = useMemo(() => closedOn(announcements, today, catalog?.resources ?? []), [announcements, today, catalog]);

  // pull-to-refresh: re-read everything on the page
  const refresh = useCallback(async () => {
    await Promise.all([reload(), reloadNotices()]);
    window.dispatchEvent(new Event(REFRESH_EVENT));
  }, [reload, reloadNotices]);

  if (!supabaseConfigured) return <NotConfigured />;
  if (!now || !catalog) return <Loader label="Opening the live board" className="py-32" />;

  const t = now.getTime();
  const nowH = istHour(now.toISOString());
  const dow = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now) === "Sun" ? 0 : 1);
  const span = (o: Occupancy) => ({ s: new Date(o.start_at).getTime(), e: new Date(o.end_at).getTime() });
  const activeNow = occupancy.filter((o) => { const { s, e } = span(o); return s <= t && t < e; });
  const deskIds = new Set(desks.map((d) => d.id));
  const desksInUse = new Set(activeNow.filter((o) => deskIds.has(o.resource_id) && o.status === "confirmed").map((o) => o.resource_id));
  const beingBooked = occupancy.filter((o) => o.status === "held").length;
  const roomsBusy = new Set(activeNow.filter((o) => o.kind !== "desk" && !deskIds.has(o.resource_id)).map((o) => o.resource_id));
  const zones = [...new Set(desks.map((d) => d.zone ?? "?"))];

  return (
    <PullToRefresh onRefresh={refresh}>
    <div className="relative mx-auto max-w-6xl px-4 py-10">
      <PageHeader kicker="happening at the*spark" title="Live now" right={<LiveBadge state={live} />} />
      <p className="mt-1 text-xs text-ink/45 md:hidden">Pull down to refresh</p>

      <div className="mt-6 space-y-3">
        <BusyNudge />
        {[...new Set(closedToday.values())].map((msg) => (
          <p key={msg} className="flex items-center gap-2 rounded-2xl bg-spark-light/70 px-4 py-2.5 text-sm">
            <SparkMark className="h-4 w-4 shrink-0 text-spark-dark" />
            <span><b>Today:</b> {msg}</span>
          </p>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* clock */}
        <div className="relative overflow-hidden rounded-2xl bg-ink p-6 text-paper">
          <SparkMark className="pointer-events-none absolute -bottom-10 -right-10 h-48 w-48 text-spark/15 spark-spin [animation-duration:30s]" />
          <p className="font-serif italic text-spark">
            {new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}
          </p>
          <p className="mt-2 font-light tabular-nums text-[clamp(48px,9vw,88px)] leading-none">
            {new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)}
          </p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-paper/60">IST · {slotLabel(nowH, dow)}</p>
        </div>

        {/* headline numbers */}
        <div className="grid grid-cols-3 gap-3">
          {[
            [desksInUse.size, `of ${desks.length}`, "desks in use"],
            [roomsBusy.size, `of ${rooms.length}`, "rooms in use"],
            [beingBooked, "seats", "being booked"],
          ].map(([v, sub, label]) => (
            <div key={String(label)} className="card flex flex-col justify-between p-4">
              <p className="text-[10px] uppercase tracking-[0.12em] text-ink/55">{label}</p>
              <p className="mt-3 text-4xl font-light tabular-nums">{v}</p>
              <p className="text-xs text-ink/50">{sub}</p>
            </div>
          ))}
          <div className="card col-span-3 p-4">
            <p className="text-[10px] uppercase tracking-[0.12em] text-ink/55">Desks in use by zone</p>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {zones.map((z) => {
                const total = desks.filter((d) => d.zone === z).length;
                const used = desks.filter((d) => d.zone === z && desksInUse.has(d.id)).length;
                return (
                  <div key={z}>
                    <div className="flex justify-between text-xs"><span>Zone <b className="text-spark-dark">{z}</b></span><span className="text-ink/50">{used}/{total}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-cream"><div className="h-full rounded-full bg-spark" style={{ width: `${(used / total) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {user && (
        <div className="mt-6">
          <OngoingTicket />
        </div>
      )}

      <TodayEvents t={t} />

      {/* rooms, with a day timeline and a "now" line */}
      <div className="card relative mt-6 p-5">
        <CornerSpark />
        <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">Rooms today</p>
        <div className="mt-4 space-y-3">
          {rooms.map((r) => <RoomNowRow key={r.id} room={r} occupancy={occupancy} t={t} nowH={nowH} closedMsg={closedToday.get(r.id)} />)}
        </div>
        <div className="mt-2 grid grid-cols-[40%_1fr] gap-3 sm:grid-cols-[34%_1fr]">
          <span />
          <div className="relative h-4 text-[10px] text-ink/40">
            {[8, 12, 16, 20].map((h) => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - 8) / 14) * 100}%` }}>{fmtHour(h)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}

function RoomNowRow({ room, occupancy, t, nowH, closedMsg }: { room: Resource; occupancy: Occupancy[]; t: number; nowH: number; closedMsg?: string }) {
  const mine = occupancy
    .filter((o) => o.resource_id === room.id)
    .map((o) => ({ o, s: new Date(o.start_at).getTime(), e: new Date(o.end_at).getTime() }))
    .sort((a, b) => a.s - b.s);
  const cur = mine.find((x) => x.s <= t && t < x.e);
  const nxt = mine.find((x) => x.s > t);
  const DAY0 = 8, DAY1 = 22;
  const pos = (h: number) => `${Math.max(0, Math.min(100, ((h - DAY0) / (DAY1 - DAY0)) * 100))}%`;

  let status: React.ReactNode;
  if (closedMsg || cur?.o.kind === "block") status = <span className="chip bg-ink/10 text-ink/60">Closed today</span>;
  else if (cur) status = <span className="chip bg-spark text-ink">In use · until {fmtHour(istHour(cur.o.end_at) || 24)}</span>;
  else if (nxt) status = <span className="chip bg-spark-pale text-spark-dark">Free · until {fmtHour(istHour(nxt.o.start_at))}</span>;
  else status = <span className="chip bg-white text-ink/60 ring-1 ring-sand">Free rest of day</span>;

  return (
    <div className="grid grid-cols-[40%_1fr] items-center gap-3 sm:grid-cols-[34%_1fr]">
      <div className="min-w-0">
        <p className="truncate text-sm">{room.name}</p>
        <div className="mt-0.5">{status}</div>
      </div>
      <div className="relative h-7 rounded-lg bg-cream/70">
        {mine.map(({ o }) => {
          const s = o.kind === "block" ? DAY0 : istHour(o.start_at);
          const e = o.kind === "block" ? DAY1 : istHour(o.end_at) || 24;
          return (
            <div key={o.booking_id}
              className={`absolute inset-y-1 rounded-md ${o.kind === "block" ? "hatch bg-ink/10" : o.status === "held" ? "bg-spark-light" : "bg-spark"}`}
              style={{ left: pos(s), width: `calc(${pos(e)} - ${pos(s)})` }}
              title={`${fmtHour(s)} – ${fmtHour(e)}`} />
          );
        })}
        {nowH >= DAY0 && nowH <= DAY1 && (
          <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: pos(nowH) }}>
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-ink" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Events today and next up (Live board). */
function TodayEvents({ t }: { t: number }) {
  const { events } = useEvents();
  const { mine } = useMyRsvps();
  const today = todayIST();
  const upcoming = (events ?? []).filter((e) => e.status === "published" && new Date(e.ends_at).getTime() > t);
  const todays = upcoming.filter((e) => new Date(e.starts_at).toLocaleDateString("en-CA", { timeZone: TZ }) === today);
  const list = (todays.length ? todays : upcoming).slice(0, 3);
  if (!list.length) return null;
  const live = list.find((e) => new Date(e.starts_at).getTime() <= t);
  return (
    <div className="card relative mt-6 p-5">
      <CornerSpark />
      <div className="flex items-baseline justify-between gap-3 pr-8">
        <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">{todays.length ? "Events today" : "Next events"}</p>
        <Link href="/events" className="text-xs text-ink/55 underline">All events</Link>
      </div>
      {live && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-spark px-3 py-1 text-xs font-medium">
          <span className="h-2 w-2 rounded-full bg-ink live-dot" /> Happening now: {live.title}
        </p>
      )}
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        {list.map((e) => <EventRow key={e.id} e={e} mine={mine.get(e.id)} />)}
      </div>
    </div>
  );
}
