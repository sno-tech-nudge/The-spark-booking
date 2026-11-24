"use client";

import { useEffect, useMemo, useState } from "react";
import { SparkMark, Spinner } from "./brand";
import { Loader } from "./ui";
import { dateRange, useAnnouncements } from "./announcements";
import { useCatalog } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CLOSURE_LABELS, closureScope, type Announcement, type Closure } from "@/lib/announcements";
import { todayIST } from "@/lib/time";

type ShowFn = (t: string, tone?: "ok" | "warn" | "error") => void;

const EXAMPLES = ["Closed on 25 Dec for Christmas", "AC servicing in Zone B on Friday", "Community lunch at 1pm today — all welcome!"];

/** Staff: post notices; a closure also blocks bookings for those dates (enforced in the database). */
export function NoticesTab({ show }: { show: ShowFn }) {
  const { catalog } = useCatalog();
  const { reload } = useAnnouncements();
  const [all, setAll] = useState<Announcement[] | null>(null);
  const [affected, setAffected] = useState<Record<string, number>>({});
  const today = todayIST();
  const [form, setForm] = useState({ message: "", starts_on: today, ends_on: today, closure: "none" as Closure, zone: "B", resource_id: "" });
  const [busy, setBusy] = useState(false);

  const zones = useMemo(() => [...new Set((catalog?.resources ?? []).filter((r) => r.kind === "desk").map((r) => r.zone!))], [catalog]);

  async function load() {
    const sb = supabaseBrowser();
    const { data } = await sb.from("announcements").select("*").order("starts_on", { ascending: false }).limit(100);
    const list = (data as Announcement[]) ?? [];
    setAll(list);
    // how many existing bookings fall inside each active closure (so staff can follow up)
    const counts: Record<string, number> = {};
    await Promise.all(list.filter((a) => a.active && a.closure !== "none" && a.ends_on >= today).map(async (a) => {
      let q = sb.from("bookings").select("id, resources!inner(kind, zone)", { count: "exact", head: true })
        .in("status", ["held", "confirmed"]).neq("kind", "block")
        .gte("booking_date", a.starts_on).lte("booking_date", a.ends_on);
      if (a.closure === "desks") q = q.eq("resources.kind", "desk");
      if (a.closure === "rooms") q = q.eq("resources.kind", "room");
      if (a.closure === "zone") q = q.eq("resources.kind", "desk").eq("resources.zone", a.zone!);
      if (a.closure === "resource") q = q.eq("resource_id", a.resource_id!);
      const { count } = await q;
      counts[a.id] = count ?? 0;
    }));
    setAffected(counts);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (form.ends_on < form.starts_on) return show("The end date is before the start date.", "error");
    setBusy(true);
    const { data: auth } = await supabaseBrowser().auth.getUser();
    const { data: created, error } = await supabaseBrowser().from("announcements").insert({
      message: form.message.trim(),
      starts_on: form.starts_on,
      ends_on: form.ends_on,
      closure: form.closure,
      zone: form.closure === "zone" ? form.zone : null,
      resource_id: form.closure === "resource" ? form.resource_id || null : null,
      created_by: auth.user?.id,
    }).select("id").single();
    setBusy(false);
    if (error) return show(error.message, "error");
    let pushed = "";
    try {
      const r = await fetch("/api/push/notice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ announcementId: created?.id }) });
      const j = await r.json();
      if (r.ok && j.people) pushed = ` · sent to ${j.people} phone${j.people === 1 ? "" : "s"}`;
    } catch { /* notification is a bonus */ }
    show((form.closure === "none" ? "Notice posted — everyone sees it now" : "Posted — those dates are now blocked for booking") + pushed);
    setForm({ ...form, message: "" });
    load();
    reload();
  }

  async function setActive(a: Announcement, active: boolean) {
    const { error } = await supabaseBrowser().from("announcements").update({ active }).eq("id", a.id);
    if (error) return show(error.message, "error");
    show(active ? "Notice switched back on" : "Notice taken down — bookings reopen");
    load();
    reload();
  }

  const nameOf = (id: string | null) => catalog?.resources.find((r) => r.id === id)?.name ?? id ?? "";

  return (
    <div className="space-y-6">
      <form onSubmit={post} className="card grid gap-4 p-5 md:grid-cols-6">
        <div className="md:col-span-6">
          <p className="font-semibold">Post a notice</p>
          <p className="text-xs text-ink/50">
            It shows as a banner across the app (from two weeks before). Choose a closure to also stop bookings on those dates — existing bookings stay, and are counted below so you can follow up.
          </p>
        </div>
        <div className="md:col-span-6">
          <label className="label">Message</label>
          <input className="field" required maxLength={200} placeholder={EXAMPLES[0]} value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button type="button" key={x} className="rounded-full border border-sand px-2.5 py-0.5 text-[11px] text-ink/60 hover:border-ink"
                onClick={() => setForm({ ...form, message: x })}>{x}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" className="field" required value={form.starts_on} min={today}
            onChange={(e) => setForm({ ...form, starts_on: e.target.value, ends_on: e.target.value > form.ends_on ? e.target.value : form.ends_on })} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="field" required value={form.ends_on} min={form.starts_on}
            onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <label className="label">What closes?</label>
          <select className="field" value={form.closure} onChange={(e) => setForm({ ...form, closure: e.target.value as Closure })}>
            {(Object.keys(CLOSURE_LABELS) as Closure[]).map((c) => <option key={c} value={c}>{CLOSURE_LABELS[c]}</option>)}
          </select>
        </div>
        {form.closure === "zone" ? (
          <div className="md:col-span-2">
            <label className="label">Zone</label>
            <select className="field" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>Zone {z}</option>)}
            </select>
          </div>
        ) : form.closure === "resource" ? (
          <div className="md:col-span-2">
            <label className="label">Seat or room</label>
            <select className="field" required value={form.resource_id} onChange={(e) => setForm({ ...form, resource_id: e.target.value })}>
              <option value="">Choose…</option>
              {catalog?.resources.map((r) => <option key={r.id} value={r.id}>{r.kind === "desk" ? `Seat ${r.id}` : r.name}</option>)}
            </select>
          </div>
        ) : <div className="md:col-span-2" />}
        <div className="md:col-span-6">
          <button className="btn-spark" disabled={busy || form.message.trim().length < 3}>
            {busy ? <><Spinner className="h-4 w-4 !text-ink" /> Posting…</> : form.closure === "none" ? "Post notice" : "Post & block bookings"}
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <p className="p-4 font-semibold">Notices</p>
        {all === null ? <Loader className="py-8" /> : all.length === 0 ? (
          <p className="px-4 pb-6 text-sm text-ink/50">No notices yet.</p>
        ) : (
          <table className="brand-table w-full min-w-[720px] text-sm">
            <thead><tr>{["Notice", "Dates", "Closes", "Bookings inside", ""].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {all.map((a) => {
                const past = a.ends_on < today;
                return (
                  <tr key={a.id} className={!a.active || past ? "opacity-50" : ""}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2"><SparkMark className="h-3.5 w-3.5 shrink-0 text-spark" />{a.message}</span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{dateRange(a)}</td>
                    <td className="px-4 py-2">{a.closure === "none" ? <span className="text-ink/50">Nothing</span> : closureScope(a, nameOf(a.resource_id))}</td>
                    <td className="px-4 py-2">
                      {a.closure === "none" || !a.active || past ? "—" : affected[a.id] ? <span className="chip bg-spark-light">{affected[a.id]} to follow up</span> : "None"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs">
                      {past ? "Ended" : a.active
                        ? <button className="underline hover:text-red-600" onClick={() => setActive(a, false)}>Take down</button>
                        : <button className="underline" onClick={() => setActive(a, true)}>Switch on</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
