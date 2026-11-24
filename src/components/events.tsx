"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./auth-provider";
import { PageHeader, SparkMark } from "./brand";
import { EventCover } from "./event-cover";
import { Loader } from "./ui";
import { NotConfigured } from "./book-seat";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { useClock } from "@/lib/hooks";
import {
  EVENT_CATEGORIES, evDay, evTime, priceLabel, spotsLeft, urgency, type Rsvp, type SparkEvent,
} from "@/lib/events";
import { istNow, toISODate, todayIST } from "@/lib/time";

// ---------------------------------------------------------------------------
// data

let eventsCache: SparkEvent[] | null = null;
const eventSubs = new Set<(e: SparkEvent[]) => void>();
let eventsChannel = false;

async function fetchEvents() {
  const since = new Date(Date.now() - 12 * 3600_000).toISOString(); // keep today's past events briefly
  const { data } = await supabaseBrowser().from("events").select("*")
    .in("status", ["published", "cancelled"]).gte("ends_at", since).order("starts_at").limit(100);
  eventsCache = (data as SparkEvent[]) ?? [];
  eventSubs.forEach((fn) => fn(eventsCache!));
}

/** Upcoming events; counters ("12 spots left") update live. */
export function useEvents() {
  const [events, setEvents] = useState<SparkEvent[] | null>(eventsCache);
  useEffect(() => {
    if (!supabaseConfigured) return;
    eventSubs.add(setEvents);
    if (!eventsCache) fetchEvents();
    if (!eventsChannel) {
      eventsChannel = true;
      supabaseBrowser().channel("events-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => fetchEvents())
        .subscribe();
    }
    return () => { eventSubs.delete(setEvents); };
  }, []);
  return { events, reload: fetchEvents };
}

/** The signed-in person's live tickets, by event id. */
export function useMyRsvps() {
  const { user } = useAuth();
  const [mine, setMine] = useState<Map<string, Rsvp>>(new Map());
  const load = useCallback(async () => {
    if (!user) return setMine(new Map());
    const { data } = await supabaseBrowser().from("event_rsvps").select("*")
      .eq("user_id", user.id).in("status", ["going", "held", "waitlist"]);
    setMine(new Map(((data as Rsvp[]) ?? []).map((r) => [r.event_id, r])));
  }, [user]);
  useEffect(() => {
    load();
    window.addEventListener("spark:rsvp", load);
    // any change to an event (someone cancels, the waitlist moves) → re-check my tickets
    eventSubs.add(load);
    return () => {
      window.removeEventListener("spark:rsvp", load);
      eventSubs.delete(load);
    };
  }, [load]);
  return { mine, reload: load };
}
export const announceRsvp = () => window.dispatchEvent(new Event("spark:rsvp"));

// ---------------------------------------------------------------------------
// cards

function UrgencyChip({ e }: { e: SparkEvent }) {
  const u = urgency(e);
  if (!u) return null;
  const cls = u.tone === "out" ? "bg-ink text-paper" : u.tone === "hot" ? "bg-red-600 text-white" : "bg-spark text-ink";
  return <span className={`chip ${cls} shadow-sm`}>{u.text}</span>;
}

function MyChip({ r }: { r?: Rsvp }) {
  if (!r) return null;
  const t = r.status === "going" ? "You're going" : r.status === "held" ? "Payment pending" : "On waitlist";
  return (
    <span className="chip inline-flex items-center gap-1 bg-white/95 text-ink shadow-sm">
      <SparkMark className="h-3 w-3 text-spark" /> {t}
    </span>
  );
}

/** Portrait card for grids (District "event tile"). */
export function EventCard({ e, mine }: { e: SparkEvent; mine?: Rsvp }) {
  return (
    <Link href={`/events/${e.slug}`} className="group block">
      <div className="relative">
        <EventCover event={e} className="aspect-[4/5] w-full transition duration-300 group-hover:-translate-y-1 group-hover:shadow-xl" />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
          {e.status === "cancelled" ? <span className="chip bg-red-600 text-white">Cancelled</span> : <UrgencyChip e={e} />}
        </div>
        <div className="absolute bottom-2 left-2"><MyChip r={mine} /></div>
      </div>
      <p className="mt-3 text-[13px] font-medium text-spark-dark">{evDay(e.starts_at)}, {evTime(e.starts_at)}</p>
      <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">{e.title}</p>
      <p className="mt-0.5 truncate text-[13px] text-ink/55">{e.venue}</p>
      <p className="mt-1 text-[13px] text-ink/80">{priceLabel(e, true)}</p>
    </Link>
  );
}

/** Wide featured card for the carousel. */
export function EventCardWide({ e, mine }: { e: SparkEvent; mine?: Rsvp }) {
  return (
    <Link href={`/events/${e.slug}`} className="group relative block w-[85vw] max-w-[560px] shrink-0 snap-start sm:w-[520px]">
      <EventCover event={e} showTitle={false} className="aspect-[16/9] w-full" rounded="rounded-3xl" />
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-ink/85 via-ink/20 to-transparent" />
      <div className="absolute left-4 top-4 flex gap-2"><UrgencyChip e={e} /><MyChip r={mine} /></div>
      <div className="absolute inset-x-0 bottom-0 p-5 text-paper">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-spark">{e.category} · {evDay(e.starts_at)}, {evTime(e.starts_at)}</p>
        <p className="mt-1 text-2xl font-light uppercase leading-tight">{e.title}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="truncate text-sm text-paper/75">{e.host_name}{e.host_org ? ` · ${e.host_org}` : ""}</p>
          <span className="shrink-0 rounded-full bg-paper px-3 py-1 text-xs font-semibold text-ink transition group-hover:bg-spark">
            {priceLabel(e, true)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Small row card for side panels (Live board, home). */
export function EventRow({ e, mine }: { e: SparkEvent; mine?: Rsvp }) {
  const left = spotsLeft(e);
  return (
    <Link href={`/events/${e.slug}`} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-cream/60">
      <EventCover event={e} showTitle={false} className="h-16 w-16 shrink-0" rounded="rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-spark-dark">{evDay(e.starts_at)}, {evTime(e.starts_at)}</p>
        <p className="truncate font-medium">{e.title}</p>
        <p className="text-xs text-ink/55">{mine ? (mine.status === "going" ? "You're going" : mine.status === "waitlist" ? "On waitlist" : "Payment pending") : left ? `${e.going_count} going · ${left} left` : "Sold out · waitlist open"}</p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// the events page

const FILTERS = ["All", "Today", "This week", "Weekend", "Free", ...EVENT_CATEGORIES] as const;
type Filter = (typeof FILTERS)[number];

function matches(e: SparkEvent, f: Filter): boolean {
  const day = new Date(e.starts_at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = todayIST();
  const wk = istNow();
  wk.setDate(wk.getDate() + 7);
  switch (f) {
    case "All": return true;
    case "Today": return day === today;
    case "This week": return day >= today && day <= toISODate(wk);
    case "Weekend": {
      const dow = new Date(e.starts_at).toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
      return (dow === "Sat" || dow === "Sun") && day <= toISODate(wk);
    }
    case "Free": return e.member_price === 0 && e.guest_price === 0;
    default: return e.category === f;
  }
}

export function EventsPage() {
  const clock = useClock(60_000);
  const { events } = useEvents();
  const { mine } = useMyRsvps();
  const [filter, setFilter] = useState<Filter>("All");

  const upcoming = useMemo(
    () => (events ?? []).filter((e) => !clock || new Date(e.ends_at).getTime() > clock.getTime()),
    [events, clock],
  );
  const featured = upcoming.filter((e) => e.status === "published").slice(0, 4);
  const list = upcoming.filter((e) => matches(e, filter));

  if (!supabaseConfigured) return <NotConfigured />;

  return (
    <div className="relative mx-auto max-w-6xl px-4 py-10">
      <PageHeader kicker="programmes & gatherings" title="Events" sub="Talks, workshops and meet-ups at the*spark — RSVP in a tap." />

      {events === null ? (
        <Loader label="Finding events" className="py-24" />
      ) : upcoming.length === 0 ? (
        <div className="card mt-8 p-10 text-center">
          <SparkMark className="mx-auto h-10 w-10 text-spark" />
          <p className="mt-3 font-medium">No events scheduled yet</p>
          <p className="text-sm text-ink/60">Check back soon — the team posts new programmes every week.</p>
        </div>
      ) : (
        <>
          {/* featured carousel */}
          <div className="-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            {featured.map((e) => <EventCardWide key={e.id} e={e} mine={mine.get(e.id)} />)}
          </div>

          {/* filters */}
          <div className="sticky top-16 z-20 -mx-4 mt-8 flex gap-2 overflow-x-auto bg-paper/90 px-4 py-3 backdrop-blur [scrollbar-width:none]">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${
                  filter === f ? "border-ink bg-ink text-paper" : "border-sand bg-white/70 text-ink/75 hover:border-ink/40"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink/55">Nothing for “{filter}” yet — try another filter.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((e) => <EventCard key={e.id} e={e} mine={mine.get(e.id)} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "Upcoming at the*spark" strip for the home page. */
export function HomeEvents() {
  const clock = useClock(60_000);
  const { events } = useEvents();
  const { mine } = useMyRsvps();
  const list = (events ?? []).filter((e) => e.status === "published" && (!clock || new Date(e.ends_at).getTime() > clock.getTime())).slice(0, 8);
  if (!supabaseConfigured || (events && !list.length)) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink/60">Programmes & gatherings</p>
          <h2 className="mt-2 text-3xl font-light uppercase">Upcoming events</h2>
        </div>
        <Link href="/events" className="btn-ghost">See all →</Link>
      </div>
      {events === null ? <Loader className="py-12" /> : (
        <div className="-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {list.map((e) => (
            <div key={e.id} className="w-[44vw] max-w-[240px] shrink-0 snap-start sm:w-[220px]">
              <EventCard e={e} mine={mine.get(e.id)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
