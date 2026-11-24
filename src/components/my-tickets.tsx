"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { EventCover } from "./event-cover";
import { supabaseBrowser } from "@/lib/supabase/client";
import { evDay, evTime, type Rsvp, type SparkEvent } from "@/lib/events";

type Row = Rsvp & { events: SparkEvent };

/** "My tickets" strip on My bookings: upcoming event tickets and waitlist spots. */
export function MyTickets() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabaseBrowser().from("event_rsvps").select("*, events(*)")
      .eq("user_id", user.id).in("status", ["going", "held", "waitlist"]).order("created_at", { ascending: false });
    setRows(((data as Row[]) ?? []).filter((r) => r.events && new Date(r.events.ends_at).getTime() > Date.now())
      .sort((a, b) => a.events.starts_at.localeCompare(b.events.starts_at)));
  }, [user]);
  useEffect(() => {
    load();
    window.addEventListener("spark:rsvp", load);
    return () => window.removeEventListener("spark:rsvp", load);
  }, [load]);
  if (!rows?.length) return null;
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">My tickets</p>
        <Link href="/events" className="text-xs text-ink/55 underline">Browse events</Link>
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {rows.map((r) => (
          <Link key={r.id} href={`/events/${r.events.slug}${r.status === "going" ? "?ticket=1" : ""}`}
            className="flex w-[280px] shrink-0 snap-start items-center gap-3 rounded-2xl border border-sand bg-white p-2.5 transition hover:border-ink/30">
            <EventCover event={r.events} showTitle={false} className="h-16 w-16 shrink-0" rounded="rounded-xl" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-spark-dark">{evDay(r.events.starts_at)}, {evTime(r.events.starts_at)}</p>
              <p className="truncate font-medium">{r.events.title}</p>
              <p className="text-xs text-ink/55">
                {r.status === "going" ? "Ticket · tap to show QR" : r.status === "held" ? "Payment pending" : "On the waitlist"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
