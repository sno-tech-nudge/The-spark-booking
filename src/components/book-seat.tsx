"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";
import { Checkout } from "./checkout";
import { announceHoldChange } from "./hold-timer";
import { AddToCalendar } from "./calendar-actions";
import { PushNudge } from "./push-notifications";
import { DateStrip, LiveBadge, Loader, Sheet, Toast, useToast } from "./ui";
import { SeatLegend, SeatMap, seatStates } from "./seat-map";
import { PageHeader, SparkMark, Spinner } from "./brand";
import { useCatalog, useLiveOccupancy, useMounted, useUsage } from "@/lib/hooks";
import { useAnnouncements } from "./announcements";
import { BusyNudge } from "./nudges";
import { closedOn } from "@/lib/announcements";
import { buzz } from "@/lib/haptics";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { PARTS, fmtDate, inr, openDays } from "@/lib/time";
import type { Booking, Part } from "@/lib/types";

export function BookSeat() {
  const mounted = useMounted();
  const { ready, user, profile } = useAuth();
  const { catalog } = useCatalog();
  const days = useMemo(() => (mounted ? openDays(14) : []), [mounted]);
  const [date, setDate] = useState<string | null>(null);
  const [part, setPart] = useState<Part>("full");
  const [selected, setSelected] = useState<string | null>(null);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<Booking | null>(null);
  const [done, setDone] = useState<Booking | null>(null);
  const { toast, show } = useToast();
  const { occupancy, live, flash } = useLiveOccupancy(date);
  const { usage, reload: reloadUsage } = useUsage(Boolean(user));

  useEffect(() => {
    if (!days.length || date) return;
    const wanted = new URLSearchParams(window.location.search).get("date");
    setDate(days.find((d) => d.date === wanted)?.date ?? days[0].date);
  }, [days, date]);

  // Came back mid-checkout? Pick up the seat still on hold (like BookMyShow).
  useEffect(() => {
    if (!user || !supabaseConfigured) return;
    supabaseBrowser()
      .from("bookings").select("*").eq("user_id", user.id).eq("status", "held")
      .gt("hold_expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const b = data as Booking | null;
        if (!b) return;
        setDate(b.booking_date);
        if (b.part) setPart(b.part);
        setSelected(b.resource_id);
        setHeld(b);
      });
  }, [user]);

  // my own bookings for the day (so the map can colour them "Yours")
  const loadMine = useCallback(async () => {
    if (!user || !date) return setMyIds(new Set());
    const { data } = await supabaseBrowser()
      .from("bookings").select("id").eq("user_id", user.id).eq("booking_date", date).in("status", ["held", "confirmed"]);
    setMyIds(new Set((data ?? []).map((b: { id: string }) => b.id)));
  }, [user, date]);
  useEffect(() => { loadMine(); }, [loadMine, occupancy.length]);

  const desks = useMemo(() => catalog?.resources.filter((r) => r.kind === "desk") ?? [], [catalog]);
  const { announcements } = useAnnouncements();
  const closed = useMemo(() => closedOn(announcements, date, desks), [announcements, date, desks]);
  const states = useMemo(
    () => seatStates(desks, occupancy, part, myIds, usage?.assigned_seat_id ?? null, closed),
    [desks, occupancy, part, myIds, usage?.assigned_seat_id, closed],
  );
  // closure notes on the date strip ("Closed", "Zone B shut")
  const dayMarks = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of days) {
      const c = closedOn(announcements, d.date, desks);
      if (!c.size) continue;
      if (c.size >= desks.length) { m.set(d.date, "Closed"); continue; }
      const zones = [...new Set(desks.filter((x) => c.has(x.id)).map((x) => x.zone))];
      m.set(d.date, zones.length === 1 && desks.filter((x) => x.zone === zones[0]).every((x) => c.has(x.id)) ? `Zone ${zones[0]} shut` : "Some closed");
    }
    return m;
  }, [announcements, days, desks]);
  const dayNotices = [...new Set(closed.values())];
  const freeCount = [...states.values()].filter((s) => s === "free").length;

  // if the seat I'm looking at gets taken by someone else, tell me right away
  useEffect(() => {
    if (!selected || held || busy) return;
    const s = states.get(selected);
    if (s && s !== "free" && s !== "my-seat" && s !== "mine") {
      show(`Seat ${selected} was just taken. Pick another.`, "warn");
      setSelected(null);
    }
  }, [states, selected, held, busy, show]);

  const settings = catalog?.settings;
  const isMember = Boolean(usage?.plan_id);
  const partInfo = PARTS.find((p) => p.id === part)!;
  const units = part === "full" ? 1 : 0.5;
  const price = part === "full" ? settings?.day_pass_price ?? 500 : settings?.half_day_price ?? 300;
  const overage =
    isMember && usage?.desk_days_included != null && Number(usage.desk_days_used) + units > Number(usage.desk_days_included);

  async function confirm() {
    if (!selected || !date) return;
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("book_desk", { p_resource_id: selected, p_date: date, p_part: part });
    setBusy(false);
    if (error) {
      show(friendlyError(error), "error");
      if (error.message.includes("TAKEN")) setSelected(null);
      return;
    }
    const b = data as Booking;
    setMyIds((prev) => new Set(prev).add(b.id));
    if (b.status === "held") {
      setHeld(b);
      announceHoldChange();
    } else {
      setSelected(null);
      setDone(b);
      buzz();
      reloadUsage();
    }
  }

  async function releaseHold() {
    if (held) await supabaseBrowser().rpc("cancel_booking", { p_id: held.id }).then(() => {}, () => {});
    setHeld(null);
    setSelected(null);
    loadMine();
    announceHoldChange();
  }

  if (!supabaseConfigured) return <NotConfigured />;

  return (
    <div className="relative mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        kicker="flexibility, by design"
        title="Pick your seat"
        sub={<>127 open-plan seats · {isMember ? `${usage?.plan_name} member` : `Day pass ${inr(settings?.day_pass_price ?? 500)} · half day ${inr(settings?.half_day_price ?? 300)}`}</>}
        right={<LiveBadge state={live} />}
      />

      <div className="mt-6 space-y-4">
        <BusyNudge onPick={(d) => { setDate(d); setSelected(null); }} />
        <DateStrip days={days} value={date} marks={dayMarks} onChange={(d) => { setDate(d); setSelected(null); }} />
        {dayNotices.map((msg) => (
          <p key={msg} className="flex items-center gap-2 rounded-2xl bg-spark-light/70 px-4 py-2.5 text-sm">
            <SparkMark className="h-4 w-4 shrink-0 text-spark-dark" />
            <span><b>{msg}</b> <span className="text-ink/60">— those seats can&apos;t be booked this day.</span></span>
          </p>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full bg-ink/5 p-1">
            {PARTS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setPart(p.id); setSelected(null); }}
                className={`rounded-full px-4 py-2 text-sm transition ${part === p.id ? "bg-ink text-paper shadow" : "text-ink/70 hover:text-ink"}`}
              >
                <span className="font-medium">{p.label}</span>
                <span className="ml-1.5 hidden text-xs opacity-70 sm:inline">{p.time}</span>
              </button>
            ))}
          </div>
          <p className="text-sm">
            <span className="text-3xl font-light tabular-nums">{catalog ? freeCount : "—"}</span>
            <span className="text-ink/60"> seats free</span>
          </p>
        </div>
        <SeatLegend />
      </div>

      <div className="mt-6">
        {!catalog || !date ? (
          <Loader label="Loading the floor" className="py-24" />
        ) : (
          <SeatMap desks={desks} states={states} selected={selected} flash={flash} onSelect={(id) => { setSelected(id); setDone(null); }} />
        )}
      </div>

      {/* Booking sheet */}
      <Sheet open={Boolean(selected) || Boolean(done)} onClose={() => { if (!held && !busy) { setSelected(null); setDone(null); } }}>
        {done ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-spark"><SparkMark className="h-8 w-8 text-white seat-pop" /></div>
            <div>
              <p className="text-lg font-semibold">Seat {done.resource_id} is yours</p>
              <p className="text-sm text-ink/60">
                {fmtDate(done.booking_date)} · {PARTS.find((p) => p.id === done.part)?.time}
                {done.billing === "overage" && ` · ${inr(done.amount)} added to your next invoice`}
                {done.billing === "paid" && ` · paid`}
              </p>
            </div>
            <div className="rounded-2xl bg-cream/70 p-3 text-left">
              <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ink/55">Add to your calendar · get reminders</p>
              <AddToCalendar booking={done} resourceName={`Seat ${done.resource_id}`} />
            </div>
            <PushNudge label="Remind me 15 min before" />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setDone(null)}>Book another</button>
              <Link href="/me" className="btn-ink flex-1">My bookings</Link>
            </div>
          </div>
        ) : held && selected ? (
          <Checkout
            booking={held}
            holdMinutes={settings?.hold_minutes ?? 10}
            gstRate={Number(settings?.gst_rate ?? 18)}
            title={`Seat ${held.resource_id} · ${fmtDate(held.booking_date)} · ${partInfo.label}`}
            onPaid={(b) => {
              setHeld(null);
              setSelected(null);
              loadMine();
              announceHoldChange();
              if (b.status === "confirmed") { setDone(b); buzz(); }
              else show("Payment received, but the seat was released before it completed. We'll refund you in full.", "error");
            }}
            onCancel={releaseHold}
          />
        ) : selected && date ? (
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink/50">Zone {selected.split("-")[0]}</p>
                <p className="text-2xl font-semibold">Seat {selected}</p>
                <p className="text-sm text-ink/60">{fmtDate(date)} · {partInfo.label} · {partInfo.time}</p>
              </div>
              <button className="text-ink/40 hover:text-ink" onClick={() => setSelected(null)} aria-label="Close">✕</button>
            </div>

            {!ready ? null : !user ? (
              <div className="space-y-3">
                <p className="text-sm text-ink/70">Sign in with your email to book. Members book free under their plan; anyone else can book a day pass.</p>
                <Link href={`/login?next=/book`} className="btn-spark w-full">Sign in to book</Link>
              </div>
            ) : (
              <>
                <div className="rounded-2xl bg-cream px-4 py-3 text-sm">
                  {isMember ? (
                    usage?.desk_days_included == null ? (
                      <p>Included in your <b>{usage?.plan_name}</b> plan.</p>
                    ) : overage ? (
                      <p>You&apos;ve used {usage.desk_days_used} of {usage.desk_days_included} desk days this month. This one is <b>{inr(price)}</b> (excl. GST) on your next invoice.</p>
                    ) : (
                      <p>Uses {units} of your desk days · {Number(usage.desk_days_included) - Number(usage.desk_days_used)} left this month.</p>
                    )
                  ) : (
                    <p>
                      {part === "full" ? "Day pass" : "Half-day pass"} <b>{inr(price)}</b> + GST. Your seat is held for <b>{settings?.hold_minutes ?? 10} minutes</b> while you pay.
                      {profile?.role === "admin" && " (Staff accounts book as guests.)"}
                    </p>
                  )}
                </div>
                <button className="btn-spark w-full text-base" onClick={confirm} disabled={busy}>
                  {busy ? <><Spinner className="h-4 w-4 !text-ink" /> Booking…</> : isMember ? "Confirm booking" : "Hold seat & pay"}
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

export function NotConfigured() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-light uppercase">Almost there</h1>
      <p className="mt-2 text-ink/60">Connect a Supabase project to start booking. The README has the steps.</p>
    </div>
  );
}
