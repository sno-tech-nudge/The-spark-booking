"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { Loader, Meter, Toast, useToast } from "./ui";
import { NotConfigured } from "./book-seat";
import { PageHeader, Spinner } from "./brand";
import { AddToCalendar, CalendarSync } from "./calendar-actions";
import { OngoingTicket } from "./now-board";
import { InstallCard } from "./pwa";
import { useCatalog, useMounted, useUsage } from "@/lib/hooks";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { PARTS, fmtDate, fmtHour, inr, istHour, parseRange, todayIST } from "@/lib/time";
import type { Booking } from "@/lib/types";

export function MyBookings() {
  const mounted = useMounted();
  const { ready, user, profile, refreshProfile } = useAuth();
  const { catalog } = useCatalog();
  const { usage, reload: reloadUsage } = useUsage(Boolean(user));
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabaseBrowser()
      .from("bookings").select("*").eq("user_id", user.id).neq("kind", "block")
      .order("booking_date", { ascending: true }).order("slot", { ascending: true }).limit(200);
    setBookings((data as Booking[]) ?? []);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: "cancel_booking" | "check_in" | "check_out", id: string, okText: string) {
    const { error } = await supabaseBrowser().rpc(fn, { p_id: id });
    if (error) return show(friendlyError(error), "error");
    show(okText);
    load();
    reloadUsage();
  }

  if (!supabaseConfigured) return <NotConfigured />;
  if (ready && !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-light uppercase">Sign in to see your bookings</h1>
        <Link href="/login?next=/me" className="btn-spark mt-4">Sign in</Link>
      </div>
    );
  }

  const today = mounted ? todayIST() : "";
  const nameOf = (id: string) => catalog?.resources.find((r) => r.id === id)?.name ?? id;
  const live = (bookings ?? []).filter((b) => b.status === "confirmed" || b.status === "held");
  const upcoming = live.filter((b) => b.booking_date >= today && new Date(parseRange(b.slot).end) > new Date());
  const past = (bookings ?? []).filter((b) => !upcoming.includes(b)).reverse();
  const list = tab === "upcoming" ? upcoming : past;

  return (
    <div className="relative mx-auto max-w-5xl px-4 py-10">
      <PageHeader kicker="welcome back" title={`Hi${profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`} sub={user?.email} />

      <div className="mt-6">
        <OngoingTicket compact />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="card p-5 md:col-span-2">
          {usage?.plan_id ? (
            <>
              <div className="flex items-baseline justify-between">
                <p className="font-semibold">{usage.plan_name}</p>
                <span className="chip bg-spark text-ink">Active</span>
              </div>
              {usage.assigned_seat_id && <p className="mt-1 text-sm text-ink/60">Your fixed desk: <b>{usage.assigned_seat_id}</b></p>}
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-ink/60">
                    <span>Desk days this month</span>
                    <span>{usage.desk_days_used}{usage.desk_days_included != null ? ` / ${usage.desk_days_included}` : " · unlimited"}</span>
                  </div>
                  {usage.desk_days_included != null && <Meter used={Number(usage.desk_days_used)} total={Number(usage.desk_days_included)} />}
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-ink/60">
                    <span>Room hours this month</span>
                    <span>{usage.room_hours_used} / {usage.room_hours_included}</span>
                  </div>
                  <Meter used={Number(usage.room_hours_used)} total={Number(usage.room_hours_included ?? 0)} />
                </div>
              </div>
              <p className="mt-4 text-sm">
                Overage this month: <b>{inr(usage.overage_amount)}</b> <span className="text-ink/50">(excl. GST, added to your next invoice)</span>
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Day pass guest</p>
              <p className="mt-1 text-sm text-ink/60">Book a seat by the day or half day. Interested in a membership? Ask at the front desk.</p>
            </>
          )}
        </div>
        <ProfileCard onSaved={() => { refreshProfile(); show("Profile saved"); }} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <CalendarSync />
        <InstallCard />
      </div>

      <div className="mt-8 flex items-center justify-between">
        <div className="inline-flex rounded-full bg-ink/5 p-1 text-sm">
          {(["upcoming", "past"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 capitalize ${tab === t ? "bg-ink text-paper" : "text-ink/70"}`}>{t}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <Link href="/book" className="btn-spark text-sm">Book a seat</Link>
          {usage?.plan_id && <Link href="/rooms" className="btn-ghost">Book a room</Link>}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {bookings === null ? (
          <Loader label="Loading your bookings" />
        ) : list.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink/60">{tab === "upcoming" ? "No upcoming bookings." : "Nothing here yet."}</div>
        ) : (
          list.map((b) => {
            const r = parseRange(b.slot);
            const when = b.kind === "desk"
              ? PARTS.find((p) => p.id === b.part)?.time
              : `${fmtHour(istHour(r.start))} – ${fmtHour(istHour(r.end) || 24)}`;
            const isToday = b.booking_date === today;
            return (
              <div key={b.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cream text-center text-xs font-semibold leading-tight">
                  {b.kind === "desk" ? b.resource_id : "Room"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{b.kind === "desk" ? `Seat ${b.resource_id}` : nameOf(b.resource_id)}</p>
                  <p className="text-sm text-ink/60">{fmtDate(b.booking_date)} · {when}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip b={b} />
                  {tab === "upcoming" && b.status === "confirmed" && (
                    <AddToCalendar compact booking={b} resourceName={b.kind === "desk" ? `Seat ${b.resource_id}` : nameOf(b.resource_id)} />
                  )}
                  {tab === "upcoming" && b.status === "confirmed" && isToday && !b.checked_in_at && (
                    <button className="btn-ink !py-1.5 text-sm" onClick={() => act("check_in", b.id, "Checked in — welcome!")}>Check in</button>
                  )}
                  {tab === "upcoming" && b.checked_in_at && !b.checked_out_at && (
                    <button className="btn-ghost" onClick={() => act("check_out", b.id, "Checked out. See you soon!")}>Check out</button>
                  )}
                  {tab === "upcoming" && !b.checked_in_at && (
                    <button className="text-xs text-ink/50 underline hover:text-red-600"
                      onClick={() => confirm("Cancel this booking?") && act("cancel_booking", b.id, "Booking cancelled")}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}

function StatusChip({ b }: { b: Booking }) {
  if (b.status === "cancelled") return <span className="chip bg-ink/10 text-ink/60">Cancelled{b.billing === "refund_due" ? " · refund due" : ""}</span>;
  if (b.status === "expired") return <span className="chip bg-ink/10 text-ink/60">{b.billing === "refund_due" ? "Refund due" : "Hold expired"}</span>;
  if (b.status === "held") return <span className="chip bg-held/40">Awaiting payment</span>;
  if (b.checked_out_at) return <span className="chip bg-ink/10">Checked out</span>;
  if (b.checked_in_at) return <span className="chip bg-ink text-spark">Checked in</span>;
  const billing: Record<string, string> = {
    included: "Included", overage: `Overage ${inr(b.amount)}`, free: "Free", paid: `Paid ${inr(b.amount)}`,
  };
  return <span className={`chip ${b.billing === "overage" ? "bg-spark-light text-ink" : "bg-spark-pale text-spark-dark"}`}>{billing[b.billing] ?? "Confirmed"}</span>;
}

function ProfileCard({ onSaved }: { onSaved: () => void }) {
  const { user, profile } = useAuth();
  const [form, setForm] = useState({ full_name: "", phone: "", organisation: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (profile) setForm({ full_name: profile.full_name ?? "", phone: profile.phone ?? "", organisation: profile.organisation ?? "" });
  }, [profile]);
  return (
    <form
      className="card space-y-2 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await supabaseBrowser().from("profiles").update({
          full_name: form.full_name.trim() || null, phone: form.phone.trim() || null, organisation: form.organisation.trim() || null,
        }).eq("id", user!.id);
        setBusy(false);
        onSaved();
      }}
    >
      <p className="font-semibold">Your details</p>
      <input className="field" placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      <input className="field" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      <input className="field" placeholder="Organisation" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
      <button className="btn-ghost w-full" disabled={busy}>{busy ? <><Spinner className="h-4 w-4" /> Saving…</> : "Save"}</button>
    </form>
  );
}
