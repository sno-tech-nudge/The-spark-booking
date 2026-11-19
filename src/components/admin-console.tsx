"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";
import { LiveBadge, Loader, Stat, Toast, useToast } from "./ui";
import { NotConfigured } from "./book-seat";
import { PageHeader, Spinner } from "./brand";
import { NoticesTab } from "./admin-notices";
import { SeatLegend, SeatMap, seatStates } from "./seat-map";
import { useCatalog, useLiveOccupancy, useMounted } from "@/lib/hooks";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { PARTS, fmtDate, fmtDateTime, fmtHour, inr, istHour, parseRange, todayIST, toISODate, istNow } from "@/lib/time";
import type { Booking, Part, Plan, Profile, Resource, Settings } from "@/lib/types";

type AdminBooking = Booking & { profiles: Pick<Profile, "full_name" | "email" | "phone" | "organisation"> | null };
type Membership = {
  id: string; email: string; user_id: string | null; plan_id: string; status: "active" | "paused" | "ended";
  starts_on: string; ends_on: string | null; organisation: string | null; assigned_seat_id: string | null; created_at: string;
  profiles: Pick<Profile, "full_name" | "phone"> | null;
};

const TABS = ["Live", "Bookings", "Members", "Notices", "Pricing", "Reports"] as const;
type Tab = (typeof TABS)[number];

export function AdminConsole() {
  const { ready, profile } = useAuth();
  const [tab, setTab] = useState<Tab>("Live");
  const { toast, show } = useToast();

  if (!supabaseConfigured) return <NotConfigured />;
  if (!ready) return <div className="mx-auto max-w-6xl px-4 py-16"><div className="grid h-40 place-items-center"><Spinner className="h-8 w-8" /></div></div>;
  if (profile?.role !== "admin") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-xl font-light uppercase">Staff only</h1>
        <p className="mt-2 text-sm text-ink/60">Sign in with a staff account to use the admin panel.</p>
        <Link href="/login?next=/admin" className="btn-spark mt-4">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          kicker="staff console"
          title="Admin"
          right={
            <a href="/display" target="_blank" rel="noopener" className="btn-ink !py-2 text-sm" title="Open the full-screen board for the TV at the entrance">
              Reception screen ↗
            </a>
          }
        />
        <div className="inline-flex flex-wrap rounded-full bg-ink/5 p-1 text-sm">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 ${tab === t ? "bg-ink text-paper" : "text-ink/70 hover:text-ink"}`}>{t}</button>
          ))}
        </div>
      </div>
      <div className="mt-6">
        {tab === "Live" && <LiveTab show={show} />}
        {tab === "Bookings" && <BookingsTab show={show} />}
        {tab === "Members" && <MembersTab show={show} />}
        {tab === "Pricing" && <PricingTab show={show} />}
        {tab === "Reports" && <ReportsTab />}
        {tab === "Notices" && <NoticesTab show={show} />}
      </div>
      <Toast toast={toast} />
    </div>
  );
}

type ShowFn = (t: string, tone?: "ok" | "warn" | "error") => void;

function useDayBookings(date: string | null, refreshKey: unknown) {
  const [rows, setRows] = useState<AdminBooking[] | null>(null);
  const load = useCallback(async () => {
    if (!date) return;
    const { data } = await supabaseBrowser()
      .from("bookings")
      .select("*, profiles(full_name, email, phone, organisation)")
      .eq("booking_date", date)
      .order("slot");
    setRows((data as AdminBooking[]) ?? []);
  }, [date]);
  useEffect(() => { load(); }, [load, refreshKey]);
  return { rows, reload: load };
}

function who(b: AdminBooking) {
  if (b.kind === "block") return `Blocked${b.note ? ` · ${b.note}` : ""}`;
  return b.profiles?.full_name || b.profiles?.email || "—";
}

function whenText(b: Booking) {
  if (b.kind === "desk") return PARTS.find((p) => p.id === b.part)?.label ?? "";
  if (b.kind === "block") return "All day";
  const r = parseRange(b.slot);
  return `${fmtHour(istHour(r.start))}–${fmtHour(istHour(r.end) || 24)}`;
}

// ---------------------------------------------------------------------------

function LiveTab({ show }: { show: ShowFn }) {
  const mounted = useMounted();
  const today = mounted ? todayIST() : null;
  const { catalog } = useCatalog();
  const { occupancy, live, flash, now: nowMs } = useLiveOccupancy(today);
  const { rows, reload } = useDayBookings(today, occupancy);
  const [part, setPart] = useState<Part>("full");
  const [seat, setSeat] = useState<string | null>(null);

  const desks = useMemo(() => catalog?.resources.filter((r) => r.kind === "desk") ?? [], [catalog]);
  const states = useMemo(() => seatStates(desks, occupancy, part, new Set(), null), [desks, occupancy, part]);
  const active = (rows ?? []).filter((b) => b.status === "confirmed" || b.status === "held");
  const deskBookings = active.filter((b) => b.kind === "desk");
  const deskUnits = deskBookings.filter((b) => b.status === "confirmed").reduce((s, b) => s + (b.part === "full" ? 1 : 0.5), 0);
  const inNow = active.filter((b) => b.checked_in_at && !b.checked_out_at).length;
  const holds = active.filter((b) => b.status === "held").length;
  const roomsNow = active.filter((b) => b.kind === "room" && (() => {
    const r = parseRange(b.slot);
    return new Date(r.start).getTime() <= nowMs && nowMs < new Date(r.end).getTime();
  })()).length;
  const nameBySeat = new Map<string, string>();
  for (const b of deskBookings) {
    if (b.part === part || b.part === "full" || part === "full") {
      nameBySeat.set(b.resource_id, [nameBySeat.get(b.resource_id), `${who(b)} (${b.part})`].filter(Boolean).join(", "));
    }
  }

  async function act(fn: "cancel_booking" | "check_in" | "check_out", id: string, ok: string) {
    const { error } = await supabaseBrowser().rpc(fn, { p_id: id });
    if (error) return show(friendlyError(error), "error");
    show(ok);
    reload();
  }

  const seatRows = seat ? active.filter((b) => b.resource_id === seat) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/60">Today · {today ? fmtDate(today) : ""}</p>
        <LiveBadge state={live} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Desk occupancy" value={`${Math.round((deskUnits / Math.max(desks.length, 1)) * 100)}%`} sub={`${deskUnits} of ${desks.length} desk-days`} />
        <Stat label="Checked in now" value={inNow} />
        <Stat label="Rooms in use now" value={roomsNow} />
        <Stat label="Seats on payment hold" value={holds} />
        <Stat label="Bookings today" value={active.filter((b) => b.kind !== "block").length} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-full bg-ink/5 p-1 text-sm">
              {PARTS.map((p) => (
                <button key={p.id} onClick={() => setPart(p.id)} className={`rounded-full px-3 py-1 ${part === p.id ? "bg-ink text-paper" : "text-ink/70"}`}>{p.label}</button>
              ))}
            </div>
            <SeatLegend />
          </div>
          {catalog && <SeatMap desks={desks} states={states} selected={seat} flash={flash} onSelect={setSeat} labelFor={(id) => nameBySeat.get(id)} />}
        </div>

        <div className="space-y-3">
          {seat && (
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">Seat {seat}</p>
                <button className="text-ink/40" onClick={() => setSeat(null)}>✕</button>
              </div>
              {seatRows.length === 0 ? <p className="mt-2 text-sm text-ink/60">Free all day.</p> : seatRows.map((b) => (
                <BookingRow key={b.id} b={b} act={act} />
              ))}
            </div>
          )}
          <div className="card p-4">
            <p className="font-semibold">Today&apos;s bookings</p>
            <div className="mt-2 max-h-[560px] space-y-1 overflow-y-auto">
              {rows === null ? <Loader className="py-8" />
                : active.length === 0 ? <p className="text-sm text-ink/50">No bookings yet today.</p>
                : active.map((b) => <BookingRow key={b.id} b={b} act={act} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookingRow({ b, act }: { b: AdminBooking; act: (fn: "cancel_booking" | "check_in" | "check_out", id: string, ok: string) => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-ink/5 py-2 text-sm first:border-0">
      <span className="w-14 shrink-0 font-mono text-xs">{b.resource_id}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate">{who(b)}</p>
        <p className="text-xs text-ink/50">
          {whenText(b)} · {b.status === "held" ? "on hold (paying)" : b.billing}
          {b.checked_in_at && ` · in ${fmtDateTime(b.checked_in_at).split(", ").pop()}`}
          {b.checked_out_at && " · out"}
        </p>
      </div>
      {b.kind !== "block" && b.status === "confirmed" && !b.checked_in_at && (
        <button className="chip bg-spark-pale text-spark-dark hover:bg-spark hover:text-ink" onClick={() => act("check_in", b.id, "Checked in")}>Check in</button>
      )}
      {b.checked_in_at && !b.checked_out_at && (
        <button className="chip bg-ink/10 hover:bg-ink hover:text-paper" onClick={() => act("check_out", b.id, "Checked out")}>Out</button>
      )}
      <button className="chip text-ink/40 hover:bg-red-600 hover:text-white" onClick={() => confirm("Cancel this booking?") && act("cancel_booking", b.id, "Cancelled")}>✕</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BookingsTab({ show }: { show: ShowFn }) {
  const mounted = useMounted();
  const { catalog } = useCatalog();
  const [date, setDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "desk" | "room" | "block">("all");
  const [showAll, setShowAll] = useState(false);
  const [block, setBlock] = useState({ resource: "", note: "" });
  useEffect(() => { if (mounted && !date) setDate(todayIST()); }, [mounted, date]);
  const { rows, reload } = useDayBookings(date, null);

  const list = (rows ?? [])
    .filter((b) => filter === "all" || b.kind === filter)
    .filter((b) => showAll || b.status === "confirmed" || b.status === "held");

  async function act(fn: "cancel_booking" | "check_in" | "check_out", id: string, ok: string) {
    const { error } = await supabaseBrowser().rpc(fn, { p_id: id });
    if (error) return show(friendlyError(error), "error");
    show(ok);
    reload();
  }

  async function doBlock(e: React.FormEvent) {
    e.preventDefault();
    if (!block.resource || !date) return;
    const { error } = await supabaseBrowser().rpc("admin_block", { p_resource_id: block.resource, p_date: date, p_note: block.note || null });
    if (error) return show(friendlyError(error), "error");
    show(`${block.resource} blocked for ${fmtDate(date)}`);
    setBlock({ resource: "", note: "" });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Date</label>
          <input type="date" className="field" value={date ?? ""} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="inline-flex rounded-full bg-ink/5 p-1 text-sm">
          {(["all", "desk", "room", "block"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 capitalize ${filter === f ? "bg-ink text-paper" : "text-ink/70"}`}>{f === "block" ? "blocks" : f}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-ink/70">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> include cancelled / expired
        </label>
      </div>

      <div className="card overflow-x-auto">
        <table className="brand-table w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs text-ink/50">
            <tr>{["Resource", "Who", "When", "Status", "Billing", "Amount", "Check-in", ""].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={8}><Loader label="Loading bookings" className="py-10" /></td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-6 text-ink/50">No bookings.</td></tr>
            ) : list.map((b) => (
              <tr key={b.id} className="border-t border-ink/5">
                <td className="px-4 py-2 font-mono text-xs">{b.resource_id}</td>
                <td className="px-4 py-2">
                  <p>{who(b)}</p>
                  {b.profiles?.phone && <p className="text-xs text-ink/50">{b.profiles.phone}</p>}
                </td>
                <td className="px-4 py-2">{whenText(b)}</td>
                <td className="px-4 py-2 capitalize">{b.status}</td>
                <td className="px-4 py-2">{b.billing.replace("_", " ")}</td>
                <td className="px-4 py-2 tabular-nums">{b.amount ? inr(b.amount) : "—"}</td>
                <td className="px-4 py-2 text-xs">{b.checked_in_at ? fmtDateTime(b.checked_in_at) : "—"}</td>
                <td className="px-4 py-2 text-right">
                  {(b.status === "confirmed" || b.status === "held") && (
                    <button className="text-xs text-ink/50 underline hover:text-red-600" onClick={() => confirm("Cancel this booking?") && act("cancel_booking", b.id, "Cancelled")}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={doBlock} className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <p className="font-semibold">Block a seat or room</p>
          <p className="text-xs text-ink/50">For maintenance or private use, on {date ? fmtDate(date) : "—"}. Fails if it&apos;s already booked.</p>
        </div>
        <select className="field w-auto" value={block.resource} onChange={(e) => setBlock({ ...block, resource: e.target.value })}>
          <option value="">Choose…</option>
          {catalog?.resources.map((r) => <option key={r.id} value={r.id}>{r.kind === "desk" ? `Seat ${r.id}` : r.name}</option>)}
        </select>
        <input className="field w-48" placeholder="Reason (optional)" value={block.note} onChange={(e) => setBlock({ ...block, note: e.target.value })} />
        <button className="btn-ink" disabled={!block.resource}>Block</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MembersTab({ show }: { show: ShowFn }) {
  const { catalog, reload: reloadCatalog } = useCatalog();
  const [members, setMembers] = useState<Membership[] | null>(null);
  const [guests, setGuests] = useState<(Profile & { created_at: string })[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ email: "", plan_id: "flexi", organisation: "", starts_on: "", assigned_seat_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const [m, g] = await Promise.all([
      sb.from("memberships").select("*, profiles(full_name, phone)").order("created_at", { ascending: false }),
      sb.from("profiles").select("*").eq("role", "guest").order("created_at", { ascending: false }).limit(100),
    ]);
    setMembers((m.data as Membership[]) ?? []);
    setGuests((g.data as (Profile & { created_at: string })[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const plans = catalog?.plans ?? [];
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? id;
  const isFixed = plans.find((p) => p.id === form.plan_id)?.assigned_seat;
  const freeSeats = (catalog?.resources ?? []).filter((r) => r.kind === "desk" && !r.assigned_membership);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabaseBrowser().from("memberships").insert({
      email: form.email.trim().toLowerCase(),
      plan_id: form.plan_id,
      organisation: form.organisation || null,
      starts_on: form.starts_on || toISODate(istNow()),
      assigned_seat_id: isFixed && form.assigned_seat_id ? form.assigned_seat_id : null,
    });
    setBusy(false);
    if (error) {
      return show(error.message.includes("memberships_one_active_per_email") ? "That email already has an active membership." : error.message, "error");
    }
    show(`${form.email} added. They can sign in with that email now.`);
    setForm({ email: "", plan_id: form.plan_id, organisation: "", starts_on: "", assigned_seat_id: "" });
    load();
    reloadCatalog();
  }

  async function update(id: string, patch: Partial<Membership>) {
    const { error } = await supabaseBrowser().from("memberships").update(patch).eq("id", id);
    if (error) return show(error.message, "error");
    show("Membership updated");
    load();
    reloadCatalog();
  }

  const filtered = (members ?? []).filter((m) =>
    !q || [m.email, m.organisation, m.profiles?.full_name, m.assigned_seat_id].some((v) => v?.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="card grid gap-3 p-5 md:grid-cols-6">
        <div className="md:col-span-6">
          <p className="font-semibold">Add a member</p>
          <p className="text-xs text-ink/50">They sign in with this email and get plan pricing straight away. Fixed Desk is for contract members.</p>
        </div>
        <div className="md:col-span-2">
          <label className="label">Email</label>
          <input type="email" required className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Plan</label>
          <select className="field" value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Organisation</label>
          <input className="field" value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} />
        </div>
        <div>
          <label className="label">Starts</label>
          <input type="date" className="field" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
        </div>
        {isFixed ? (
          <div>
            <label className="label">Assigned seat</label>
            <select className="field" required value={form.assigned_seat_id} onChange={(e) => setForm({ ...form, assigned_seat_id: e.target.value })}>
              <option value="">Choose…</option>
              {freeSeats.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
            </select>
          </div>
        ) : <div />}
        <div className="md:col-span-6">
          <button className="btn-spark" disabled={busy}>{busy ? <><Spinner className="h-4 w-4 !text-ink" /> Adding…</> : "Add member"}</button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="font-semibold">Memberships ({members?.length ?? "…"})</p>
          <input className="field max-w-60" placeholder="Search name, email, org, seat" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <table className="brand-table w-full min-w-[820px] text-sm">
          <thead className="text-left text-xs text-ink/50">
            <tr>{["Member", "Organisation", "Plan", "Seat", "Since", "Status", ""].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="border-t border-ink/5">
                <td className="px-4 py-2">
                  <p>{m.profiles?.full_name || m.email}</p>
                  <p className="text-xs text-ink/50">{m.email}{!m.user_id && " · hasn't signed in yet"}</p>
                </td>
                <td className="px-4 py-2">{m.organisation ?? "—"}</td>
                <td className="px-4 py-2">
                  <select className="rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm" value={m.plan_id}
                    disabled={m.status !== "active"}
                    onChange={(e) => update(m.id, { plan_id: e.target.value, assigned_seat_id: plans.find((p) => p.id === e.target.value)?.assigned_seat ? m.assigned_seat_id : null })}>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{m.assigned_seat_id ?? "—"}</td>
                <td className="px-4 py-2">{m.starts_on}</td>
                <td className="px-4 py-2">
                  <span className={`chip ${m.status === "active" ? "bg-spark text-ink" : "bg-ink/10 text-ink/60"}`}>{m.status}</span>
                </td>
                <td className="px-4 py-2 text-right text-xs">
                  {m.status === "active" ? (
                    <>
                      <button className="mr-3 underline" onClick={() => update(m.id, { status: "paused" })}>Pause</button>
                      <button className="underline hover:text-red-600" onClick={() => confirm(`End ${m.email}'s ${planName(m.plan_id)} membership?`) && update(m.id, { status: "ended", ends_on: todayIST() })}>End</button>
                    </>
                  ) : m.status === "paused" ? (
                    <button className="underline" onClick={() => update(m.id, { status: "active" })}>Reactivate</button>
                  ) : null}
                </td>
              </tr>
            ))}
            {members?.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-ink/50">No members yet. Add one above.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <p className="p-4 font-semibold">Day-pass guests ({guests.length}) <span className="text-xs font-normal text-ink/50">— details saved from public bookings</span></p>
        <table className="brand-table w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-ink/50">
            <tr>{["Name", "Email", "Phone", "Organisation", "Signed up"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {guests.map((g) => (
              <tr key={g.id} className="border-t border-ink/5">
                <td className="px-4 py-2">{g.full_name ?? "—"}</td>
                <td className="px-4 py-2">{g.email}</td>
                <td className="px-4 py-2">{g.phone ?? "—"}</td>
                <td className="px-4 py-2">{g.organisation ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{fmtDateTime(g.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PricingTab({ show }: { show: ShowFn }) {
  const { catalog, reload } = useCatalog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [rooms, setRooms] = useState<Resource[]>([]);
  useEffect(() => {
    if (!catalog) return;
    setSettings(catalog.settings);
    setPlans(catalog.plans);
    setRooms(catalog.resources.filter((r) => r.kind === "room"));
  }, [catalog]);

  async function save() {
    const sb = supabaseBrowser();
    const results = await Promise.all([
      sb.from("settings").update({
        day_pass_price: settings!.day_pass_price, half_day_price: settings!.half_day_price,
        hold_minutes: settings!.hold_minutes, gst_rate: settings!.gst_rate,
        busy_nudge_pct: settings!.busy_nudge_pct ?? 80,
      }).eq("id", true),
      ...plans.map((p) => sb.from("plans").update({
        monthly_price: p.monthly_price, desk_days_included: p.desk_days_included, room_hours_included: p.room_hours_included,
      }).eq("id", p.id)),
      ...rooms.map((r) => sb.from("resources").update({ hourly_rate: r.hourly_rate, min_hours: r.min_hours }).eq("id", r.id)),
    ]);
    const err = results.find((r) => r.error);
    if (err?.error) return show(err.error.message, "error");
    show("Prices saved — new bookings use them right away");
    reload();
  }

  if (!settings) return <Loader label="Loading prices" />;
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="space-y-6">
      <div className="card grid gap-4 p-5 sm:grid-cols-4">
        <p className="font-semibold sm:col-span-4">Day passes & checkout</p>
        {([
          ["day_pass_price", "Day pass (₹)"], ["half_day_price", "Half-day pass (₹)"],
          ["hold_minutes", "Seat hold while paying (min)"], ["gst_rate", "GST %"],
          ["busy_nudge_pct", "“Book now” nudge when a day is ≥ (%) full"],
        ] as const).map(([k, label]) => (
          <div key={k}>
            <label className="label">{label}</label>
            <input type="number" className="field" value={settings[k] ?? 80} onChange={(e) => setSettings({ ...settings, [k]: num(e.target.value) })} />
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto p-5">
        <p className="font-semibold">Plans</p>
        <table className="brand-table mt-3 w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-ink/50"><tr><th className="py-2">Plan</th><th>Monthly ₹</th><th>Desk days / month (blank = unlimited)</th><th>Room hours / month</th></tr></thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={p.id} className="border-t border-ink/5">
                <td className="py-2 pr-3">{p.name}</td>
                <td className="pr-3"><input type="number" className="field" value={p.monthly_price} onChange={(e) => setPlans(plans.map((x, j) => j === i ? { ...x, monthly_price: num(e.target.value) } : x))} /></td>
                <td className="pr-3"><input type="number" className="field" value={p.desk_days_included ?? ""} onChange={(e) => setPlans(plans.map((x, j) => j === i ? { ...x, desk_days_included: e.target.value === "" ? null : num(e.target.value) } : x))} /></td>
                <td><input type="number" className="field" value={p.room_hours_included} onChange={(e) => setPlans(plans.map((x, j) => j === i ? { ...x, room_hours_included: num(e.target.value) } : x))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto p-5">
        <p className="font-semibold">Rooms</p>
        <table className="brand-table mt-3 w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-ink/50"><tr><th className="py-2">Room</th><th>₹ / hour (0 = free, members only)</th><th>Minimum hours</th></tr></thead>
          <tbody>
            {rooms.map((r, i) => (
              <tr key={r.id} className="border-t border-ink/5">
                <td className="py-2 pr-3">{r.name}</td>
                <td className="pr-3"><input type="number" className="field" value={r.hourly_rate} onChange={(e) => setRooms(rooms.map((x, j) => j === i ? { ...x, hourly_rate: num(e.target.value) } : x))} /></td>
                <td><input type="number" className="field" value={r.min_hours} onChange={(e) => setRooms(rooms.map((x, j) => j === i ? { ...x, min_hours: Math.max(1, num(e.target.value)) } : x))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-spark" onClick={save}>Save prices</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReportsTab() {
  const mounted = useMounted();
  const { catalog } = useCatalog();
  const [rows, setRows] = useState<AdminBooking[] | null>(null);
  const [payments, setPayments] = useState<{ amount: number; gst_amount: number; status: string; created_at: string }[]>([]);

  useEffect(() => {
    if (!mounted) return;
    const end = istNow();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    const ahead = new Date(end);
    ahead.setDate(ahead.getDate() + 45); // overage for the rest of the month is already known
    const sb = supabaseBrowser();
    Promise.all([
      sb.from("bookings").select("*, profiles(full_name, email, phone, organisation)")
        .gte("booking_date", toISODate(start)).lte("booking_date", toISODate(ahead)).eq("status", "confirmed").limit(10000),
      sb.from("payments").select("amount, gst_amount, status, created_at").gte("created_at", start.toISOString()),
    ]).then(([b, p]) => {
      setRows((b.data as AdminBooking[]) ?? []);
      setPayments(p.data ?? []);
    });
  }, [mounted]);

  const desks = catalog?.resources.filter((r) => r.kind === "desk").length ?? 127;
  const days = useMemo(() => {
    if (!mounted) return [];
    const out: string[] = [];
    const d = istNow();
    for (let i = 29; i >= 0; i--) {
      const x = new Date(d);
      x.setDate(d.getDate() - i);
      if (x.getDay() !== 0) out.push(toISODate(x));
    }
    return out;
  }, [mounted]);

  if (!rows) return <Loader label="Crunching the numbers" />;

  const today = todayIST();
  const pastRows = rows.filter((b) => b.booking_date <= today);
  const deskRows = pastRows.filter((b) => b.kind === "desk");
  const perDay = days.map((d) => ({
    d,
    units: deskRows.filter((b) => b.booking_date === d).reduce((s, b) => s + (b.part === "full" ? 1 : 0.5), 0),
  }));
  const avg = perDay.length ? perDay.reduce((s, x) => s + x.units, 0) / perDay.length / desks : 0;
  const peak = perDay.reduce((m, x) => (x.units > m.units ? x : m), { d: "", units: 0 });
  const captured = payments.filter((p) => p.status === "captured");
  const revenue = captured.reduce((s, p) => s + p.amount, 0);
  const refunds = payments.filter((p) => p.status === "refund_due");
  const month = today.slice(0, 7);
  const overage = rows.filter((b) => b.billing === "overage" && b.booking_date.startsWith(month));
  const overageBy = new Map<string, { name: string; amount: number; n: number }>();
  for (const b of overage) {
    const k = b.user_id;
    const cur = overageBy.get(k) ?? { name: who(b), amount: 0, n: 0 };
    cur.amount += b.amount;
    cur.n += 1;
    overageBy.set(k, cur);
  }
  const roomRows = pastRows.filter((b) => b.kind === "room");
  const roomHours = new Map<string, number>();
  for (const b of roomRows) {
    const r = parseRange(b.slot);
    roomHours.set(b.resource_id, (roomHours.get(b.resource_id) ?? 0) + (new Date(r.end).getTime() - new Date(r.start).getTime()) / 3_600_000);
  }
  const roomsList = catalog?.resources.filter((r) => r.kind === "room") ?? [];
  const openHours = (catalog?.settings?.close_hour ?? 18) - (catalog?.settings?.open_hour ?? 9);
  const checkins = deskRows.filter((b) => b.checked_in_at).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink/60">Last 30 days (open days only). Amounts excl. GST.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Avg desk occupancy" value={`${Math.round(avg * 100)}%`} />
        <Stat label="Busiest day" value={peak.units ? `${Math.round((peak.units / desks) * 100)}%` : "—"} sub={peak.d ? fmtDate(peak.d) : ""} />
        <Stat label="Day-pass revenue" value={inr(revenue)} sub={`${captured.length} payments`} />
        <Stat label="Overage to invoice (this month)" value={inr(overage.reduce((s, b) => s + b.amount, 0))} sub={`${overage.length} bookings`} />
        <Stat label="Check-in rate" value={deskRows.length ? `${Math.round((checkins / deskRows.length) * 100)}%` : "—"} sub={refunds.length ? `${refunds.length} refunds due` : undefined} />
      </div>

      <div className="card p-5">
        <p className="font-semibold">Desk occupancy by day</p>
        <div className="mt-4 flex h-40 items-end gap-1">
          {perDay.map((x) => {
            const pct = Math.min(100, (x.units / desks) * 100);
            return (
              <div key={x.d} className="group relative flex-1" title={`${fmtDate(x.d)}: ${Math.round(pct)}% (${x.units} desk-days)`}>
                <div className={`rounded-t transition group-hover:bg-ink ${pct >= 70 ? "bg-spark-dark" : pct >= 35 ? "bg-spark" : "bg-spark-light"}`} style={{ height: `${Math.max(pct, 1) * 1.6}px` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-ink/40">
          <span>{perDay[0] ? fmtDate(perDay[0].d) : ""}</span><span>{perDay.at(-1) ? fmtDate(perDay.at(-1)!.d) : ""}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <p className="font-semibold">Room utilisation</p>
          <div className="mt-3 space-y-2">
            {roomsList.map((r) => {
              const h = roomHours.get(r.id) ?? 0;
              const pct = Math.min(100, (h / Math.max(days.length * openHours, 1)) * 100);
              return (
                <div key={r.id} className="text-sm">
                  <div className="flex justify-between"><span>{r.name}</span><span className="text-ink/50">{h} h · {Math.round(pct)}%</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-ink/10"><div className="h-full rounded-full bg-graphite" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card p-5">
          <p className="font-semibold">Overage by member · {month}</p>
          {overageBy.size === 0 ? <p className="mt-3 text-sm text-ink/50">No overage this month.</p> : (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {[...overageBy.values()].sort((a, b) => b.amount - a.amount).map((o) => (
                  <tr key={o.name} className="border-t border-ink/5">
                    <td className="py-2">{o.name}</td>
                    <td className="py-2 text-ink/50">{o.n} booking{o.n > 1 ? "s" : ""}</td>
                    <td className="py-2 text-right tabular-nums">{inr(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
