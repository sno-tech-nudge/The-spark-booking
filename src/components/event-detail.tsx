"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { useAuth } from "./auth-provider";
import { SparkMark, Spinner } from "./brand";
import { Checkout } from "./checkout";
import { EventCover } from "./event-cover";
import { EventCard, announceRsvp, useEvents, useMyRsvps } from "./events";
import { PushNudge } from "./push-notifications";
import { Loader, Sheet, Toast, useToast } from "./ui";
import { NotConfigured } from "./book-seat";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { useCatalog, useClock, useUsage } from "@/lib/hooks";
import { friendlyError } from "@/lib/errors";
import { buzz } from "@/lib/haptics";
import { buildIcs, googleCalendarUrl, CENTRE_ADDRESS, type CalEvent } from "@/lib/calendar";
import { publicOrigin } from "@/lib/site";
import { evDay, evRange, evTime, fillRatio, priceLabel, spotsLeft, urgency, type Rsvp, type SparkEvent } from "@/lib/events";
import { inr } from "@/lib/time";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const CAL = "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z";
const PIN = "M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z";
const PEOPLE = "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8";
const TAG = "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01";

function eventToCal(e: SparkEvent): CalEvent {
  return {
    uid: `event-${e.id}@thespark-booking`,
    title: `${e.title} · the*spark`,
    start: new Date(e.starts_at),
    end: new Date(e.ends_at),
    location: `${e.venue}, ${CENTRE_ADDRESS}`,
    description: `${e.tagline ?? ""}\nHosted by ${e.host_name}${e.host_org ? `, ${e.host_org}` : ""}\n${publicOrigin()}/events/${e.slug}`.trim(),
  };
}

export function EventDetail() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const clock = useClock(30_000);
  const mounted = Boolean(clock);
  const { user, ready } = useAuth();
  const { events } = useEvents();
  const { mine, reload } = useMyRsvps();
  const { catalog } = useCatalog();
  const { usage } = useUsage(Boolean(user));
  const { toast, show } = useToast();
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "pay" | "ticket">(null);
  const [expanded, setExpanded] = useState(false);

  const e = useMemo(() => events?.find((x) => x.slug === params.slug) ?? null, [events, params.slug]);
  const [fallback, setFallback] = useState<SparkEvent | null | undefined>(undefined);
  // an event further out than the list window, or a direct link: fetch it on its own
  useEffect(() => {
    if (!supabaseConfigured || events === null || e) return;
    supabaseBrowser().from("events").select("*").eq("slug", params.slug).maybeSingle()
      .then(({ data }) => setFallback((data as SparkEvent) ?? null));
  }, [events, e, params.slug]);
  const ev = e ?? fallback ?? null;
  const r: Rsvp | undefined = ev ? mine.get(ev.id) : undefined;

  // ?ticket=1 (from a push notification) opens the ticket straight away
  useEffect(() => {
    if (r?.status === "going" && new URLSearchParams(window.location.search).get("ticket")) setSheet("ticket");
  }, [r?.status]);

  if (!supabaseConfigured) return <NotConfigured />;
  if (events === null || (!e && fallback === undefined)) return <Loader label="Loading event" className="py-32" />;
  if (!ev) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <p className="text-xl font-light uppercase">Event not found</p>
        <Link href="/events" className="btn-spark mt-4">See all events</Link>
      </div>
    );
  }

  const now = clock?.getTime() ?? 0;
  const started = mounted && new Date(ev.starts_at).getTime() <= now;
  const over = mounted && new Date(ev.ends_at).getTime() <= now;
  const closed = mounted && ev.rsvp_closes_at !== null && new Date(ev.rsvp_closes_at).getTime() < now;
  const left = spotsLeft(ev);
  const u = urgency(ev);
  const more = (events ?? []).filter((x) => x.id !== ev.id && x.status === "published").slice(0, 4);
  const gstRate = Number(catalog?.settings?.gst_rate ?? 18);

  async function rsvp() {
    if (!user) {
      router.push(`/login?next=/events/${ev!.slug}`);
      return;
    }
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("rsvp_event", { p_event_id: ev!.id });
    setBusy(false);
    if (error) return show(friendlyError(error), "error");
    const row = data as Rsvp;
    await reload();
    announceRsvp();
    if (row.status === "going") { buzz(); setSheet("ticket"); }
    else if (row.status === "held") setSheet("pay");
    else show("You're on the waitlist — we'll notify you if a spot opens.", "ok");
  }

  async function leave() {
    if (!r || !confirm(r.status === "waitlist" ? "Leave the waitlist?" : "Cancel your ticket? Your spot goes to the next person.")) return;
    setBusy(true);
    const { error } = await supabaseBrowser().rpc("cancel_rsvp", { p_id: r.id });
    setBusy(false);
    if (error) return show(friendlyError(error), "error");
    await reload();
    announceRsvp();
    setSheet(null);
    show(r.status === "waitlist" ? "You've left the waitlist" : "Ticket cancelled");
  }

  // the price this person pays (member or guest), once we know who they are
  const viewerPrice = user ? (usage?.plan_id ? ev.member_price : ev.guest_price) : null;
  const viewerLabel = viewerPrice === null ? priceLabel(ev, true) : viewerPrice === 0 ? "Free" : `${inr(viewerPrice)} + GST`;
  const viewerNote = viewerPrice === null ? (ev.member_price !== ev.guest_price ? "Sign in for your price" : "") : usage?.plan_id ? "Member price" : "Guest price";

  // ---- the call-to-action (sticky bar on phones, side card on desktop)
  let cta: React.ReactNode;
  if (ev.status === "cancelled") cta = <button className="btn-ghost w-full" disabled>Event cancelled</button>;
  else if (over) cta = <button className="btn-ghost w-full" disabled>This event has ended</button>;
  else if (r?.status === "going") cta = <button className="btn-ink w-full text-base" onClick={() => setSheet("ticket")}>View your ticket</button>;
  else if (r?.status === "held") cta = <button className="btn-spark w-full text-base" onClick={() => setSheet("pay")}>Complete payment</button>;
  else if (r?.status === "waitlist") cta = <button className="btn-ghost w-full" onClick={leave} disabled={busy}>On the waitlist · Leave</button>;
  else if (started || closed) cta = <button className="btn-ghost w-full" disabled>RSVPs closed</button>;
  else cta = (
    <button className="btn-spark w-full text-base" onClick={rsvp} disabled={busy || !ready}>
      {busy ? <><Spinner className="h-4 w-4 !text-ink" /> One moment…</>
        : left === 0 ? "Join the waitlist"
        : (viewerPrice ?? Math.min(ev.member_price, ev.guest_price)) === 0 ? "RSVP · Free"
        : "Book ticket"}
    </button>
  );

  return (
    <div className="pb-28 md:pb-12">
      {/* blurred backdrop like District's desktop event page */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 scale-110 opacity-40 blur-3xl"><EventCover event={ev} showTitle={false} className="h-full w-full" rounded="" /></div>
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-8 md:grid-cols-[minmax(0,420px)_1fr] md:py-12">
          <EventCover event={ev} className="aspect-[4/5] w-full shadow-2xl" rounded="rounded-3xl" />
          <div className="flex flex-col">
            <div className="flex flex-wrap gap-2">
              <span className="chip bg-ink text-paper">{ev.category}</span>
              {ev.status === "cancelled" ? <span className="chip bg-red-600 text-white">Cancelled</span>
                : u && <span className={`chip ${u.tone === "out" ? "bg-ink/80 text-paper" : u.tone === "hot" ? "bg-red-600 text-white" : "bg-spark text-ink"}`}>{u.text}</span>}
            </div>
            <h1 className="mt-3 text-3xl font-light uppercase leading-tight sm:text-5xl">{ev.title}</h1>
            {ev.tagline && <p className="mt-2 font-serif text-lg italic text-ink/70">{ev.tagline}</p>}

            <div className="mt-6 space-y-3 text-[15px]">
              <p className="flex items-center gap-3"><Icon d={CAL} /><span><b className="font-medium">{evDay(ev.starts_at)}</b> · {evTime(ev.starts_at)} – {evTime(ev.ends_at)}</span></p>
              <p className="flex items-center gap-3"><Icon d={PIN} /><span>{ev.venue}<span className="block text-xs text-ink/50">ITPL Main Rd, Whitefield, Bengaluru</span></span></p>
              <p className="flex items-center gap-3"><Icon d={PEOPLE} /><span>{ev.going_count} going{ev.waitlist_count ? ` · ${ev.waitlist_count} on the waitlist` : ""} · {left ? `${left} of ${ev.capacity} spots left` : "sold out"}</span></p>
              <p className="flex items-center gap-3"><Icon d={TAG} /><span>{priceLabel(ev)} <span className="text-xs text-ink/50">(+GST on paid tickets)</span></span></p>
            </div>

            {/* fill bar */}
            <div className="mt-5 max-w-md">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full rounded-full bg-spark transition-[width] duration-700" style={{ width: `${fillRatio(ev) * 100}%` }} />
              </div>
            </div>

            {/* desktop CTA card */}
            <div className="card mt-auto hidden max-w-md p-5 md:mt-8 md:block">
              <div className="flex items-baseline justify-between gap-3">
                <div><p className="text-2xl font-light">{viewerLabel}</p>{viewerNote && <p className="text-xs text-ink/50">{viewerNote}</p>}</div>
                {r && <span className="chip bg-spark-pale text-spark-dark">{r.status === "going" ? "You're going" : r.status === "held" ? "Payment pending" : "On waitlist"}</span>}
              </div>
              <div className="mt-4">{cta}</div>
              {r?.status === "going" && <button className="mt-2 w-full text-xs text-ink/50 underline" onClick={leave}>Can&apos;t make it? Cancel</button>}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:grid-cols-[1fr_340px]">
        <div className="space-y-10">
          <section>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink/55">About the event</h2>
            <div className={`relative mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink/80 ${expanded ? "" : "max-h-40 overflow-hidden"}`}>
              {ev.description || "Details coming soon."}
              {!expanded && ev.description.length > 320 && <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper to-transparent" />}
            </div>
            {ev.description.length > 320 && (
              <button className="mt-2 text-sm font-medium text-spark-dark" onClick={() => setExpanded((x) => !x)}>{expanded ? "Show less" : "Read more"}</button>
            )}
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink/55">Event guide</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Duration", (() => { const m = (new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60000; return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} min`; })()],
                ["Capacity", `${ev.capacity} people`],
                ["Members", ev.member_price ? inr(ev.member_price) : "Free"],
                ["Guests", ev.guest_price ? inr(ev.guest_price) : "Free"],
              ].map(([k, v]) => (
                <div key={k} className="card p-4">
                  <p className="text-[10px] uppercase tracking-[0.12em] text-ink/50">{k}</p>
                  <p className="mt-1 font-medium">{v}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink/55">Hosted by</h2>
            <div className="card mt-3 flex items-center gap-4 p-4">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-spark text-lg font-semibold">{ev.host_name.slice(0, 1)}</span>
              <div>
                <p className="font-medium">{ev.host_name}</p>
                {ev.host_org && <p className="text-sm text-ink/55">{ev.host_org}</p>}
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink/55">Things to know</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink/70">
              {[
                "Members get member pricing automatically — just sign in with your member email.",
                "Paid tickets are held for you while you pay; if the event is full you can join the waitlist.",
                "Waitlisted? We'll notify you the moment a spot opens.",
                "Show the QR on your ticket at reception to check in.",
                "Can't make it? Cancel from your ticket so someone else can come.",
              ].map((x) => <li key={x} className="flex gap-2"><SparkMark className="mt-1 h-3 w-3 shrink-0 text-spark" />{x}</li>)}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink/55">Add to calendar</p>
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => window.open(googleCalendarUrl(eventToCal(ev)), "_blank", "noopener")}>Google</button>
              <button className="btn-ghost flex-1" onClick={() => {
                const blob = new Blob([buildIcs([eventToCal(ev)], ev.title)], { type: "text/calendar;charset=utf-8" });
                const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${ev.slug}.ics` });
                a.click();
              }}>Apple</button>
              <button className="btn-ghost flex-1" onClick={async () => {
                const url = `${publicOrigin()}/events/${ev.slug}`;
                if (navigator.share) await navigator.share({ title: ev.title, url }).catch(() => {});
                else { await navigator.clipboard.writeText(url); show("Link copied"); }
              }}>Share</button>
            </div>
          </div>
          {more.length > 0 && (
            <div>
              <p className="mb-3 text-[11px] uppercase tracking-[0.14em] text-ink/55">More at the*spark</p>
              <div className="grid grid-cols-2 gap-4">{more.slice(0, 2).map((x) => <EventCard key={x.id} e={x} />)}</div>
            </div>
          )}
        </aside>
      </div>

      {/* phone sticky booking bar (District-style) */}
      <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-30 border-t border-sand bg-paper/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-medium leading-tight">{viewerLabel}</p>
            <p className="truncate text-xs text-ink/55">{left ? `${left} spots left` : "Sold out · waitlist open"}</p>
          </div>
          <div className="flex-1">{cta}</div>
        </div>
      </div>

      {/* pay for a held ticket */}
      <Sheet open={sheet === "pay" && r?.status === "held"} onClose={() => !busy && setSheet(null)}>
        {r?.status === "held" && (
          <Checkout
            booking={r}
            kind="rsvp"
            gstRate={gstRate}
            holdMinutes={r.promoted_at ? 120 : catalog?.settings?.hold_minutes ?? 10}
            title={`${ev.title} · ${evDay(ev.starts_at)}`}
            heldLabel={r.promoted_at ? "A spot opened up for you" : "Ticket held for you"}
            lineLabel={`${r.ticket_type === "member" ? "Member" : "Guest"} ticket`}
            releaseLabel="Give up spot"
            onPaid={async (paid) => {
              await reload();
              announceRsvp();
              if (paid.status === "going") { buzz(); setSheet("ticket"); }
              else show("Payment received, but the hold had run out — we'll refund you in full.", "error");
            }}
            onCancel={leave}
          />
        )}
      </Sheet>

      {/* the ticket */}
      <Sheet open={sheet === "ticket" && r?.status === "going"} onClose={() => setSheet(null)}>
        {r?.status === "going" && <Ticket ev={ev} r={r} onCancel={leave} />}
      </Sheet>
      <Toast toast={toast} />
    </div>
  );
}

function Ticket({ ev, r, onCancel }: { ev: SparkEvent; r: Rsvp; onCancel: () => void }) {
  const { profile, user } = useAuth();
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toString(`spark-ticket:${r.id}`, { type: "svg", margin: 0, color: { dark: "#101010", light: "#ffffff" } }).then(setQr).catch(() => {});
  }, [r.id]);
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl border border-sand bg-white">
        <div className="relative">
          <EventCover event={ev} showTitle={false} className="h-28 w-full" rounded="" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/80 to-transparent" />
          <p className="absolute bottom-3 left-4 right-4 text-lg font-light uppercase leading-tight text-paper">{ev.title}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4 text-sm">
          <div><p className="text-[10px] uppercase tracking-[0.12em] text-ink/50">When</p><p className="font-medium">{evRange(ev)}</p></div>
          <div><p className="text-[10px] uppercase tracking-[0.12em] text-ink/50">Name</p><p className="truncate font-medium">{profile?.full_name || user?.email}</p></div>
          <div><p className="text-[10px] uppercase tracking-[0.12em] text-ink/50">Ticket</p><p className="font-medium">{r.ticket_type === "member" ? "Member" : "Guest"} · {r.billing === "paid" ? `Paid ${inr(r.amount)}` : "Free"}</p></div>
          <div><p className="text-[10px] uppercase tracking-[0.12em] text-ink/50">Where</p><p className="font-medium">{ev.venue.split("·")[0].trim()}</p></div>
        </div>
        <div className="relative border-t-2 border-dashed border-sand p-5">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-white ring-1 ring-sand" />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-white ring-1 ring-sand" />
          <div className="mx-auto h-40 w-40 [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="mt-3 text-center text-xs text-ink/55">{r.checked_in_at ? "Checked in ✓" : "Show this at reception to check in"}</p>
          <p className="text-center font-mono text-[10px] text-ink/35">#{r.id.slice(0, 8).toUpperCase()}</p>
        </div>
      </div>
      <PushNudge label="Remind me an hour before" />
      <button className="w-full text-xs text-ink/50 underline" onClick={onCancel}>Can&apos;t make it? Cancel ticket</button>
    </div>
  );
}

