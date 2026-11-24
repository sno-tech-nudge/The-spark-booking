import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { allSubscribedUsers, sendPushes, type PushMessage } from "@/lib/push";
import { supabaseService } from "@/lib/supabase/server";
import { PARTS, fmtHour, istHour, istNow, parseRange, toISODate, todayIST } from "@/lib/time";
import { closureScope, type Announcement } from "@/lib/announcements";

// Called every minute by Supabase (pg_cron + pg_net) with the CRON_SECRET.
// Works out which reminders are due and sends each one exactly once.
function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || got.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

const MIN = 60_000;

export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const svc = supabaseService();
  const now = Date.now();
  const today = todayIST();
  const msgs: PushMessage[] = [];

  // housekeeping: lapsed holds free up seats and event spots (and move waitlists up)
  await Promise.all([svc.rpc("expire_stale_holds", {}), svc.rpc("expire_event_holds", {})]);

  const [{ data: bookings }, { data: resources }] = await Promise.all([
    svc.from("bookings").select("id, user_id, resource_id, kind, part, slot")
      .eq("status", "confirmed").in("kind", ["desk", "room"]).eq("booking_date", today),
    svc.from("resources").select("id, name"),
  ]);
  const nameOf = new Map((resources ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));

  for (const b of bookings ?? []) {
    const { start, end } = parseRange(b.slot);
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const isDesk = b.kind === "desk";
    const name = isDesk ? `Seat ${b.resource_id}` : nameOf.get(b.resource_id) ?? b.resource_id;
    // 1) "Your seat starts in 15 min"
    if (s - now <= 16 * MIN && s - now > 9 * MIN) {
      const part = PARTS.find((p) => p.id === b.part);
      msgs.push({
        key: `start15:${b.id}`,
        userId: b.user_id,
        title: isDesk ? "Your seat starts in 15 min" : `${name} in 15 min`,
        body: isDesk
          ? `${name} · ${part?.label ?? ""} (${part?.time ?? ""}). Check in when you arrive.`
          : `${fmtHour(istHour(start))} – ${fmtHour(istHour(end) || 24)} at the*spark. Check in when you arrive.`,
        url: "/me",
      });
    }
    // 2) "Your meeting room is free in 5 min" — heads-up that the room booking is ending
    if (!isDesk && e - now <= 6 * MIN && e - now > 2 * MIN) {
      msgs.push({
        key: `end5:${b.id}`,
        userId: b.user_id,
        title: `5 minutes left · ${name}`,
        body: `Your booking ends at ${fmtHour(istHour(end) || 24)} and the room frees up for the next group. Need longer? Book the next slot.`,
        url: "/rooms",
      });
    }
  }

  // 3) events: starting in 1 hour, waitlist promotions, cancellations
  const { data: events } = await svc.from("events").select("id, slug, title, venue, starts_at, status")
    .gte("starts_at", new Date(now - 6 * 3600_000).toISOString()).lte("starts_at", new Date(now + 60 * 86400_000).toISOString());
  const evById = new Map((events ?? []).map((e: { id: string }) => [e.id, e as { id: string; slug: string; title: string; venue: string; starts_at: string; status: string }]));
  if (evById.size) {
    const { data: rsvps } = await svc.from("event_rsvps").select("id, event_id, user_id, status, promoted_at")
      .in("event_id", [...evById.keys()]).in("status", ["going", "held"]);
    for (const r of rsvps ?? []) {
      const ev = evById.get(r.event_id)!;
      const s = new Date(ev.starts_at).getTime();
      const when = `${fmtHour(istHour(ev.starts_at))}`;
      if (ev.status === "cancelled") {
        msgs.push({ key: `evcancel:${r.id}`, userId: r.user_id, title: `Cancelled: ${ev.title}`,
          body: "Sorry — this event won't go ahead. Paid tickets will be refunded.", url: `/events/${ev.slug}` });
        continue;
      }
      if (r.status === "going" && s - now <= 61 * MIN && s - now > 45 * MIN) {
        msgs.push({ key: `event60:${r.id}`, userId: r.user_id, title: `Starts in 1 hour: ${ev.title}`,
          body: `${when} · ${ev.venue}. Show your ticket at the door.`, url: `/events/${ev.slug}?ticket=1` });
      }
      if (r.promoted_at && now - new Date(r.promoted_at).getTime() < 6 * 3600_000) {
        msgs.push(r.status === "going"
          ? { key: `promoted:${r.id}`, userId: r.user_id, title: `You're in! ${ev.title}`,
              body: "A spot opened up and your ticket is confirmed.", url: `/events/${ev.slug}?ticket=1` }
          : { key: `promoted:${r.id}`, userId: r.user_id, title: `A spot opened: ${ev.title}`,
              body: "It's held for you for 2 hours — pay to confirm your ticket.", url: `/events/${ev.slug}` });
      }
    }
  }

  // 4) evening before a closure: "Notice: Zone B closed tomorrow"
  const h = istHour(new Date(now).toISOString());
  if (h >= 18 && h < 21) {
    const t = istNow();
    t.setDate(t.getDate() + 1);
    const tomorrow = toISODate(t);
    const { data: anns } = await svc.from("announcements").select("*").eq("active", true).neq("closure", "none").eq("starts_on", tomorrow);
    if (anns?.length) {
      const users = await allSubscribedUsers();
      for (const a of anns as Announcement[]) {
        const room = a.resource_id ? nameOf.get(a.resource_id) : undefined;
        for (const u of users) {
          msgs.push({ key: `notice-eve:${a.id}:${u}`, userId: u, title: `Tomorrow: ${closureScope(a, room)}`, body: a.message, url: "/book" });
        }
      }
    }
  }

  const result = await sendPushes(msgs);
  return NextResponse.json({ due: msgs.length, ...result });
}

export const GET = POST;
