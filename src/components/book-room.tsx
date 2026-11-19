"use client";

import Link from "next/link";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useAuth } from "./auth-provider";
import { DateStrip, LiveBadge, Loader, Sheet, Toast, useToast } from "./ui";
import { NotConfigured } from "./book-seat";
import { PageHeader, SparkMark, Spinner } from "./brand";
import { AddToCalendar } from "./calendar-actions";
import { useCatalog, useLiveOccupancy, useMounted, useUsage } from "@/lib/hooks";
import { useAnnouncements } from "./announcements";
import { closedOn } from "@/lib/announcements";
import { buzz } from "@/lib/haptics";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { fmtDate, fmtHour, inr, istHour, istTimestamp, openDays, todayIST } from "@/lib/time";
import type { Booking, Resource } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = {
  meeting: "Meeting rooms",
  podcast: "Podcast studio",
  phone_booth: "Phone booths",
  lounge: "Lounge workstations",
};

export function BookRoom() {
  const mounted = useMounted();
  const { user } = useAuth();
  const { catalog } = useCatalog();
  const days = useMemo(() => (mounted ? openDays(14) : []), [mounted]);
  const [date, setDate] = useState<string | null>(null);
  const [sel, setSel] = useState<{ room: Resource; start: number } | null>(null);
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const { toast, show } = useToast();
  const { occupancy, live, flash } = useLiveOccupancy(date);
  const { usage, reload: reloadUsage } = useUsage(Boolean(user));

  useEffect(() => {
    if (days.length && !date) setDate(days[0].date);
  }, [days, date]);

  const loadMine = useCallback(async () => {
    if (!user || !date) return;
    const { data } = await supabaseBrowser().from("bookings").select("id").eq("user_id", user.id).eq("booking_date", date).eq("status", "confirmed");
    setMyIds(new Set((data ?? []).map((b: { id: string }) => b.id)));
  }, [user, date]);
  useEffect(() => { loadMine(); }, [loadMine, occupancy.length]);

  const s = catalog?.settings;
  const rooms = useMemo(() => catalog?.resources.filter((r) => r.kind === "room") ?? [], [catalog]);
  const { announcements } = useAnnouncements();
  const closed = useMemo(() => closedOn(announcements, date, rooms), [announcements, date, rooms]);
  const plan = catalog?.plans.find((p) => p.id === usage?.plan_id);
  const afterHours = Boolean(plan?.after_hours_access);
  const dayStart = s?.after_hours_open ?? 8;
  const dayEnd = s?.after_hours_close ?? 22;
  const open = afterHours ? dayStart : s?.open_hour ?? 9;
  const close = afterHours ? dayEnd : s?.close_hour ?? 18;
  const hourCols = Array.from({ length: dayEnd - dayStart }, (_, i) => dayStart + i);

  // which hours are taken, per room
  const taken = useMemo(() => {
    const m = new Map<string, Map<number, "booked" | "mine" | "blocked">>();
    for (const o of occupancy) {
      if (o.kind === "desk") continue;
      const start = o.kind === "block" ? 0 : istHour(o.start_at);
      const end = o.kind === "block" ? 24 : istHour(o.end_at) || 24;
      if (!m.has(o.resource_id)) m.set(o.resource_id, new Map());
      for (let h = Math.floor(start); h < end; h++) {
        m.get(o.resource_id)!.set(h, o.kind === "block" ? "blocked" : myIds.has(o.booking_id) ? "mine" : "booked");
      }
    }
    return m;
  }, [occupancy, myIds]);

  const isToday = date === (mounted ? todayIST() : "");
  const nowHour = mounted ? istHour(new Date().toISOString()) : 0;

  // if my selection gets taken while I'm deciding
  useEffect(() => {
    if (!sel || busy) return;
    for (let h = sel.start; h < sel.start + hours; h++) {
      const t = taken.get(sel.room.id)?.get(h);
      if (t && t !== "mine") {
        show(`${sel.room.name} at ${fmtHour(h)} was just booked by someone else.`, "warn");
        setSel(null);
        return;
      }
    }
  }, [taken, sel, hours, busy, show]);

  function pick(room: Resource, h: number) {
    setDone(null);
    setSel({ room, start: h });
    setHours(Math.max(room.min_hours, 1));
  }

  const maxHours = sel ? (() => {
    let n = 0;
    for (let h = sel.start; h < close && !taken.get(sel.room.id)?.has(h); h++) n++;
    return n;
  })() : 0;

  const estimate = (() => {
    if (!sel) return null;
    const r = sel.room;
    if (r.hourly_rate === 0) return { text: "Free for members", amount: 0 };
    if (r.uses_credits && usage?.plan_id) {
      const left = Math.max(Number(usage.room_hours_included ?? 0) - Number(usage.room_hours_used), 0);
      const incl = Math.min(hours, left);
      const amt = (hours - incl) * r.hourly_rate;
      return {
        text: incl > 0
          ? `Uses ${incl} of your ${left} plan hour${left === 1 ? "" : "s"}${amt ? ` + ${inr(amt)} on your invoice` : ""}`
          : `${inr(amt)} (excl. GST) on your next invoice`,
        amount: amt,
      };
    }
    return { text: `${inr(hours * r.hourly_rate)} (excl. GST) on your next invoice`, amount: hours * r.hourly_rate };
  })();

  async function confirm() {
    if (!sel || !date) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("book_room", {
      p_resource_id: sel.room.id,
      p_start: istTimestamp(date, sel.start),
      p_hours: hours,
    });
    setBusy(false);
    if (error) return show(friendlyError(error), "error");
    const b = data as Booking;
    setMyIds((prev) => new Set(prev).add(b.id));
    setSel(null);
    setDone(b);
    buzz();
    reloadUsage();
  }

  if (!supabaseConfigured) return <NotConfigured />;

  const grouped = Object.entries(CATEGORY_LABEL)
    .map(([cat, label]) => ({ label, rooms: rooms.filter((r) => r.category === cat) }))
    .filter((g) => g.rooms.length);

  return (
    <div className="relative mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        kicker="designed for gathering"
        title="Rooms & booths"
        sub={usage?.plan_id
          ? `${usage.plan_name}: ${Math.max(Number(usage.room_hours_included ?? 0) - Number(usage.room_hours_used), 0)} plan hours left this month · bookable ${fmtHour(open)}–${fmtHour(close)}`
          : "Members only. Day passes don't include room access."}
        right={<LiveBadge state={live} />}
      />

      <div className="mt-6">
        <DateStrip days={days} value={date} onChange={(d) => { setDate(d); setSel(null); }} />
      </div>

      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-[11px] text-ink/50">
              <th className="sticky left-0 z-10 w-56 bg-white px-4 py-3 text-left font-medium">Room</th>
              {hourCols.map((h) => (
                <th key={h} className={`px-0 py-3 text-center font-medium ${h < open || h >= close ? "text-ink/25" : ""}`}>{fmtHour(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => (
              <RoomGroup key={g.label} label={g.label} cols={hourCols.length + 1}>
                {g.rooms.map((r) => (
                  <tr key={r.id} className={`border-t border-ink/5 ${flash.has(r.id) ? "bg-spark/10" : ""} transition-colors`}>
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <p className="font-medium leading-tight">{r.name}</p>
                      <p className="text-[11px] text-ink/50">
                        {r.capacity} pax · {r.hourly_rate ? `${inr(r.hourly_rate)}/h` : "free"}
                        {r.members_only && " · members"}{r.min_hours > 1 && ` · min ${r.min_hours}h`}
                      </p>
                      {closed.get(r.id) && <p className="mt-0.5 max-w-52 truncate text-[11px] font-medium text-spark-dark">Closed · {closed.get(r.id)}</p>}
                    </td>
                    {hourCols.map((h) => {
                      const t = closed.has(r.id) ? "blocked" : taken.get(r.id)?.get(h);
                      const outside = h < open || h >= close;
                      const past = isToday && h < nowHour;
                      const selected = sel?.room.id === r.id && h >= sel.start && h < sel.start + hours;
                      const disabled = Boolean(t) || outside || past || !catalog;
                      return (
                        <td key={h} className="p-0.5">
                          <button
                            disabled={disabled}
                            onClick={() => pick(r, h)}
                            title={`${r.name} · ${fmtHour(h)}${t ? ` · ${t}` : outside ? " · outside your hours" : ""}`}
                            className={`h-9 w-full rounded-md border transition ${
                              selected ? "border-ink bg-ink"
                              : t === "mine" ? "border-spark-dark bg-spark"
                              : t === "blocked" ? "hatch border-transparent bg-ink/5"
                              : t ? "border-transparent bg-mist"
                              : outside || past ? "hatch border-transparent bg-transparent"
                              : "border-sand bg-white hover:border-spark hover:bg-spark-pale"
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </RoomGroup>
            ))}
            {!catalog && (
              <tr><td colSpan={hourCols.length + 1}><Loader label="Loading rooms" /></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink/60">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-sand bg-white" /> Free</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-mist" /> Booked</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-spark" /> Yours</span>
        <span className="inline-flex items-center gap-1.5"><span className="hatch h-3 w-3 rounded" /> Closed / outside your plan&apos;s hours</span>
      </div>

      <Sheet open={Boolean(sel) || Boolean(done)} onClose={() => { if (!busy) { setSel(null); setDone(null); } }}>
        {done ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-spark"><SparkMark className="h-8 w-8 text-white seat-pop" /></div>
            <div>
              <p className="text-lg font-semibold">{rooms.find((r) => r.id === done.resource_id)?.name} booked</p>
              <p className="text-sm text-ink/60">
                {fmtDate(done.booking_date)}
                {done.amount > 0 ? ` · ${inr(done.amount)} added to your next invoice` : " · no charge"}
              </p>
            </div>
            <div className="rounded-2xl bg-cream/70 p-3 text-left">
              <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink/55">Add to your calendar · get reminders</p>
              <AddToCalendar booking={done} resourceName={rooms.find((r) => r.id === done.resource_id)?.name ?? done.resource_id} />
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setDone(null)}>Book another</button>
              <Link href="/me" className="btn-ink flex-1">My bookings</Link>
            </div>
          </div>
        ) : sel && date ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-semibold">{sel.room.name}</p>
                <p className="text-sm text-ink/60">
                  {fmtDate(date)} · {fmtHour(sel.start)} – {fmtHour(sel.start + hours)}
                </p>
              </div>
              <button className="text-ink/40 hover:text-ink" onClick={() => setSel(null)} aria-label="Close">✕</button>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-cream px-4 py-3">
              <span className="text-sm">Duration</span>
              <div className="flex items-center gap-3">
                <button className="btn-ghost h-8 w-8 !p-0" disabled={hours <= Math.max(sel.room.min_hours, 1)} onClick={() => setHours((h) => h - 1)}>−</button>
                <span className="w-12 text-center font-semibold tabular-nums">{hours} h</span>
                <button className="btn-ghost h-8 w-8 !p-0" disabled={hours >= maxHours} onClick={() => setHours((h) => h + 1)}>+</button>
              </div>
            </div>
            {maxHours < sel.room.min_hours && (
              <p className="text-sm text-red-700">Not enough free time here for the {sel.room.min_hours}-hour minimum. Try an earlier slot.</p>
            )}
            {!user ? (
              <Link href="/login?next=/rooms" className="btn-spark w-full">Sign in to book</Link>
            ) : !usage?.plan_id ? (
              <p className="rounded-2xl bg-cream px-4 py-3 text-sm">Rooms are for members. Ask the front desk about a membership.</p>
            ) : (
              <>
                <p className="text-sm text-ink/70">{estimate?.text}</p>
                <button className="btn-spark w-full text-base" onClick={confirm} disabled={busy || maxHours < sel.room.min_hours}>
                  {busy ? <><Spinner className="h-4 w-4 !text-ink" /> Booking…</> : "Confirm booking"}
                </button>
              </>
            )}
          </div>
        ) : null}
      </Sheet>
      <Toast toast={toast} />
    </div>
  );
}

function RoomGroup({ label, cols, children }: { label: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={cols} className="bg-spark px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink">{label}</td>
      </tr>
      {children}
    </>
  );
}
