"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SparkMark, Spinner } from "./brand";
import { EventCover } from "./event-cover";
import { Loader } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { EVENT_CATEGORIES, evDay, evTime, priceLabel, slugify, type EventCategory, type Rsvp, type SparkEvent } from "@/lib/events";
import { fmtDateTime, inr } from "@/lib/time";
import { useClock } from "@/lib/hooks";

type ShowFn = (t: string, tone?: "ok" | "warn" | "error") => void;
type Attendee = Rsvp & { profiles: { full_name: string | null; email: string; phone: string | null; organisation: string | null } | null };

const EMPTY = {
  title: "", tagline: "", description: "", category: "Networking" as EventCategory, host_name: "", host_org: "",
  image_url: "", venue: "Event space · the*spark Pullur Centre", date: "", start: "18:00", end: "20:00",
  capacity: 60, member_price: 0, guest_price: 0, status: "published" as SparkEvent["status"],
};

// IST date + time inputs <-> ISO
const toIso = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
const fromIso = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 330 * 60000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
};

export function EventsTab({ show }: { show: ShowFn }) {
  const clock = useClock(60_000);
  const [events, setEvents] = useState<SparkEvent[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [guests, setGuests] = useState<{ ev: SparkEvent; list: Attendee[] } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from("events").select("*").order("starts_at", { ascending: false }).limit(100);
    setEvents((data as SparkEvent[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(e?: SparkEvent) {
    if (!e) { setForm(EMPTY); setEditing("new"); return; }
    const s = fromIso(e.starts_at), en = fromIso(e.ends_at);
    setForm({
      title: e.title, tagline: e.tagline ?? "", description: e.description, category: e.category, host_name: e.host_name,
      host_org: e.host_org ?? "", image_url: e.image_url ?? "", venue: e.venue, date: s.date, start: s.time, end: en.time,
      capacity: e.capacity, member_price: e.member_price, guest_price: e.guest_price, status: e.status,
    });
    setEditing(e.id);
  }

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) return show("Images up to 5 MB, please", "error");
    setUploading(true);
    const path = `${Date.now()}-${file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-")}`;
    const sb = supabaseBrowser();
    const { error } = await sb.storage.from("event-images").upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) return show(error.message, "error");
    setForm((f) => ({ ...f, image_url: sb.storage.from("event-images").getPublicUrl(path).data.publicUrl }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date) return show("Pick a date", "error");
    if (form.end <= form.start) return show("The end time must be after the start", "error");
    setBusy(true);
    const sb = supabaseBrowser();
    const row = {
      title: form.title.trim(), tagline: form.tagline.trim() || null, description: form.description.trim(),
      category: form.category, host_name: form.host_name.trim(), host_org: form.host_org.trim() || null,
      image_url: form.image_url.trim() || null, venue: form.venue.trim(),
      starts_at: toIso(form.date, form.start), ends_at: toIso(form.date, form.end),
      capacity: Number(form.capacity), member_price: Number(form.member_price), guest_price: Number(form.guest_price),
      status: form.status,
    };
    const { error } = editing === "new"
      ? await sb.from("events").insert({ ...row, slug: slugify(row.title) })
      : await sb.from("events").update(row).eq("id", editing!);
    setBusy(false);
    if (error) return show(error.message, "error");
    show(editing === "new" ? (row.status === "published" ? "Event published — it's live now" : "Draft saved") : "Event updated");
    setEditing(null);
    load();
  }

  async function setStatus(e: SparkEvent, status: SparkEvent["status"]) {
    if (status === "cancelled" && !confirm(`Cancel “${e.title}”? Everyone with a ticket gets a notification.`)) return;
    const { error } = await supabaseBrowser().from("events").update({ status }).eq("id", e.id);
    if (error) return show(error.message, "error");
    show(status === "cancelled" ? "Event cancelled — attendees will be notified" : status === "published" ? "Published" : "Moved to drafts");
    load();
  }

  async function openGuests(ev: SparkEvent) {
    const { data } = await supabaseBrowser().from("event_rsvps")
      .select("*, profiles(full_name, email, phone, organisation)").eq("event_id", ev.id)
      .in("status", ["going", "held", "waitlist"]).order("created_at");
    setGuests({ ev, list: (data as Attendee[]) ?? [] });
  }

  async function checkIn(a: Attendee, inside: boolean) {
    const { error } = await supabaseBrowser().rpc("event_check_in", { p_id: a.id, p_in: inside });
    if (error) return show(friendlyError(error), "error");
    if (guests) openGuests(guests.ev);
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (guests) {
    const going = guests.list.filter((a) => a.status === "going");
    return (
      <div className="space-y-4">
        <button className="btn-ghost" onClick={() => setGuests(null)}>← All events</button>
        <div className="card flex flex-wrap items-center gap-4 p-4">
          <EventCover event={guests.ev} showTitle={false} className="h-16 w-16" rounded="rounded-xl" />
          <div className="flex-1">
            <p className="font-medium">{guests.ev.title}</p>
            <p className="text-sm text-ink/55">{evDay(guests.ev.starts_at)} · {evTime(guests.ev.starts_at)} · {going.length}/{guests.ev.capacity} going · {going.filter((a) => a.checked_in_at).length} checked in</p>
          </div>
        </div>
        <div className="card overflow-x-auto">
          <table className="brand-table w-full min-w-[720px] text-sm">
            <thead><tr>{["Name", "Contact", "Ticket", "Status", "Check-in"].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {guests.list.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-ink/50">No RSVPs yet.</td></tr>}
              {guests.list.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">{a.profiles?.full_name || "—"}<p className="text-xs text-ink/50">{a.profiles?.organisation}</p></td>
                  <td className="px-4 py-2 text-xs">{a.profiles?.email}<br />{a.profiles?.phone}</td>
                  <td className="px-4 py-2 capitalize">{a.ticket_type} · {a.billing === "paid" ? `paid ${inr(a.amount)}` : a.billing === "free" ? "free" : "unpaid"}</td>
                  <td className="px-4 py-2">{a.status === "going" ? "Going" : a.status === "held" ? "Paying (held)" : "Waitlist"}</td>
                  <td className="px-4 py-2">
                    {a.status === "going" && (a.checked_in_at
                      ? <button className="chip bg-ink text-spark" onClick={() => checkIn(a, false)}>✓ {fmtDateTime(a.checked_in_at).split(", ").pop()}</button>
                      : <button className="chip bg-spark-pale text-spark-dark hover:bg-spark hover:text-ink" onClick={() => checkIn(a, true)}>Check in</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="card grid gap-4 p-5 sm:grid-cols-2">
          <p className="font-semibold sm:col-span-2">{editing === "new" ? "New event" : "Edit event"}</p>
          <div className="sm:col-span-2"><label className="label">Title</label>
            <input className="field" required maxLength={120} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Impact Investing 101" /></div>
          <div className="sm:col-span-2"><label className="label">One-line tagline</label>
            <input className="field" maxLength={140} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="How funders think — and how to pitch them" /></div>
          <div><label className="label">Category</label>
            <select className="field" value={form.category} onChange={(e) => set("category", e.target.value as EventCategory)}>
              {EVENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select></div>
          <div><label className="label">Status</label>
            <select className="field" value={form.status} onChange={(e) => set("status", e.target.value as SparkEvent["status"])}>
              <option value="published">Published (live)</option><option value="draft">Draft (hidden)</option>
              {editing !== "new" && <option value="cancelled">Cancelled</option>}
            </select></div>
          <div><label className="label">Host</label>
            <input className="field" required value={form.host_name} onChange={(e) => set("host_name", e.target.value)} placeholder="Vikram Desai" /></div>
          <div><label className="label">Host organisation</label>
            <input className="field" value={form.host_org} onChange={(e) => set("host_org", e.target.value)} /></div>
          <div><label className="label">Date</label>
            <input type="date" className="field" required value={form.date} onChange={(e) => set("date", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Starts</label><input type="time" className="field" required value={form.start} onChange={(e) => set("start", e.target.value)} /></div>
            <div><label className="label">Ends</label><input type="time" className="field" required value={form.end} onChange={(e) => set("end", e.target.value)} /></div>
          </div>
          <div><label className="label">Capacity</label>
            <input type="number" min={1} max={500} className="field" required value={form.capacity} onChange={(e) => set("capacity", Number(e.target.value))} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Member ₹</label><input type="number" min={0} className="field" value={form.member_price} onChange={(e) => set("member_price", Number(e.target.value))} /></div>
            <div><label className="label">Guest ₹</label><input type="number" min={0} className="field" value={form.guest_price} onChange={(e) => set("guest_price", Number(e.target.value))} /></div>
          </div>
          <div className="sm:col-span-2"><label className="label">Venue</label>
            <input className="field" value={form.venue} onChange={(e) => set("venue", e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">About the event</label>
            <textarea className="field min-h-36" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What it's about, who should come, what to bring…" /></div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-spark" disabled={busy}>{busy ? <><Spinner className="h-4 w-4 !text-ink" /> Saving…</> : editing === "new" ? "Publish event" : "Save changes"}</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">Poster preview</p>
          <EventCover
            event={{ title: form.title || "Your event title", category: form.category, image_url: form.image_url || null,
              starts_at: form.date ? toIso(form.date, form.start) : new Date().toISOString(), host_name: form.host_name || "Host" }}
            className="aspect-[4/5] w-full shadow-lg"
          />
          <label className="btn-ghost w-full cursor-pointer">
            {uploading ? <><Spinner className="h-4 w-4" /> Uploading…</> : "Upload a poster image"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {form.image_url && <button type="button" className="w-full text-xs text-ink/50 underline" onClick={() => set("image_url", "")}>Use the generated poster instead</button>}
          <p className="text-xs text-ink/50">No image? We draw a branded poster from the category colours.</p>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/60">Publish events; members and guests RSVP or buy tickets from <Link className="underline" href="/events">/events</Link>.</p>
        <button className="btn-spark" onClick={() => edit()}>+ New event</button>
      </div>
      {events === null ? <Loader /> : events.length === 0 ? (
        <div className="card p-10 text-center text-sm text-ink/60"><SparkMark className="mx-auto mb-3 h-8 w-8 text-spark" />No events yet — create the first one.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="brand-table w-full min-w-[820px] text-sm">
            <thead><tr>{["Event", "When", "Price", "Going", "Status", ""].map((h) => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {events.map((e) => {
                const past = Boolean(clock) && new Date(e.ends_at).getTime() < clock!.getTime();
                return (
                  <tr key={e.id} className={past ? "opacity-55" : ""}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <EventCover event={e} showTitle={false} className="h-11 w-11 shrink-0" rounded="rounded-lg" />
                        <div className="min-w-0"><p className="truncate font-medium">{e.title}</p><p className="text-xs text-ink/50">{e.category} · {e.host_name}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{evDay(e.starts_at)}<p className="text-xs text-ink/50">{evTime(e.starts_at)}</p></td>
                    <td className="px-4 py-2 text-xs">{priceLabel(e)}</td>
                    <td className="px-4 py-2 tabular-nums">{e.going_count}/{e.capacity}{e.waitlist_count ? <span className="text-xs text-ink/50"> +{e.waitlist_count} waiting</span> : null}</td>
                    <td className="px-4 py-2">
                      <span className={`chip ${e.status === "published" ? "bg-spark text-ink" : e.status === "cancelled" ? "bg-red-600 text-white" : "bg-ink/10"}`}>
                        {past && e.status === "published" ? "Ended" : e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-xs whitespace-nowrap">
                      <button className="mr-3 underline" onClick={() => openGuests(e)}>Guest list</button>
                      <button className="mr-3 underline" onClick={() => edit(e)}>Edit</button>
                      {e.status === "published" && !past && <button className="underline hover:text-red-600" onClick={() => setStatus(e, "cancelled")}>Cancel</button>}
                      {e.status === "draft" && <button className="underline" onClick={() => setStatus(e, "published")}>Publish</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
