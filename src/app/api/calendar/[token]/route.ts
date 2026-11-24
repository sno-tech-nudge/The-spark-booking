import { CENTRE_ADDRESS, buildIcs, bookingToEvent } from "@/lib/calendar";
import { supabaseService } from "@/lib/supabase/server";
import type { Booking } from "@/lib/types";

// Private, subscribable calendar of one person's bookings:
//   webcal://<host>/api/calendar/<token>   (Apple Calendar)
//   Google Calendar → Other calendars → From URL
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clean = token.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) return new Response("Not found", { status: 404 });

  const svc = supabaseService();
  const { data: tok } = await svc.from("calendar_tokens").select("user_id").eq("token", clean).maybeSingle();
  if (!tok) return new Response("Not found", { status: 404 });

  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [{ data: bookings }, { data: resources }, { data: tickets }] = await Promise.all([
    svc.from("bookings").select("*").eq("user_id", tok.user_id).in("status", ["confirmed", "cancelled"])
      .in("kind", ["desk", "room"]).gte("booking_date", since).order("booking_date").limit(500),
    svc.from("resources").select("id, name"),
    svc.from("event_rsvps").select("id, status, updated_at, events(id, slug, title, venue, starts_at, ends_at, status, host_name)")
      .eq("user_id", tok.user_id).in("status", ["going", "cancelled"]).limit(200),
  ]);
  const names = new Map((resources ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));
  const origin = new URL(request.url).origin;
  const events = ((bookings as Booking[]) ?? [])
    // keep cancellations for 7 days so calendars remove them, then drop them
    // (holds that were never paid for aren't real bookings, so they never appear)
    .filter((b) => b.status === "confirmed"
      || (b.billing !== "pending_payment" && Date.now() - new Date(b.updated_at ?? b.created_at).getTime() < 7 * 86400_000))
    .map((b) => bookingToEvent(b, names.get(b.resource_id) ?? b.resource_id, origin));

  // event tickets (a cancelled ticket or event drops out of the calendar)
  type T = { id: string; status: string; updated_at: string; events: { slug: string; title: string; venue: string; starts_at: string; ends_at: string; status: string; host_name: string } | null };
  for (const t of (tickets as unknown as T[]) ?? []) {
    const e = t.events;
    if (!e || new Date(e.ends_at).getTime() < Date.now() - 30 * 86400_000) continue;
    const cancelled = t.status === "cancelled" || e.status === "cancelled";
    if (cancelled && Date.now() - new Date(t.updated_at).getTime() > 7 * 86400_000 && t.status === "cancelled") continue;
    events.push({
      uid: `rsvp-${t.id}@thespark-booking`,
      title: `${e.title} · the*spark`,
      start: new Date(e.starts_at),
      end: new Date(e.ends_at),
      location: `${e.venue}, ${CENTRE_ADDRESS}`,
      description: `Hosted by ${e.host_name}. Show your ticket QR at reception.
${origin}/events/${e.slug}?ticket=1`,
      url: `${origin}/events/${e.slug}`,
      cancelled,
    });
  }

  return new Response(buildIcs(events, "the*spark bookings"), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="the-spark.ics"',
      "cache-control": "private, max-age=300",
    },
  });
}
