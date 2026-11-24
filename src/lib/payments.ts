import "server-only";
import { supabaseServer } from "./supabase/server";

export const razorpayConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

/** Something the caller can pay for: a held seat/room booking or a held event ticket. */
export type Payable = {
  kind: "booking" | "rsvp";
  id: string;
  amount: number;
  status: string;
  hold_expires_at: string | null;
  notes: Record<string, string>;
};

const ID = /^[0-9a-f-]{36}$/i;

/** Loads the caller's own booking ({bookingId}) or ticket ({rsvpId}); RLS enforces ownership. */
export async function loadOwnPayable(body: { bookingId?: unknown; rsvpId?: unknown }) {
  const kind: Payable["kind"] | null = typeof body.rsvpId === "string" ? "rsvp" : typeof body.bookingId === "string" ? "booking" : null;
  const id = String(kind === "rsvp" ? body.rsvpId : body.bookingId);
  if (!kind || !ID.test(id)) return { error: "Bad id", status: 400 as const };

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: "Please sign in", status: 401 as const };

  if (kind === "booking") {
    const { data } = await sb.from("bookings").select("*").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
    if (!data) return { error: "Booking not found", status: 404 as const };
    const payable: Payable = {
      kind, id, amount: data.amount, status: data.status, hold_expires_at: data.hold_expires_at,
      notes: { booking_id: id, resource: data.resource_id, date: data.booking_date },
    };
    return { payable, user: auth.user };
  }
  const { data } = await sb.from("event_rsvps").select("*, events(slug, title)").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (!data) return { error: "Ticket not found", status: 404 as const };
  const payable: Payable = {
    kind, id, amount: data.amount, status: data.status, hold_expires_at: data.hold_expires_at,
    notes: { rsvp_id: id, event: (data.events as { slug: string } | null)?.slug ?? "" },
  };
  return { payable, user: auth.user };
}

export const confirmFn = (p: Payable) => (p.kind === "rsvp" ? "confirm_paid_rsvp" : "confirm_paid_booking");
export const targetColumn = (p: Payable) => (p.kind === "rsvp" ? { rsvp_id: p.id } : { booking_id: p.id });
export const resultKey = (p: Payable) => (p.kind === "rsvp" ? "rsvp" : "booking");

export async function gstRate(): Promise<number> {
  const sb = await supabaseServer();
  const { data } = await sb.from("settings").select("gst_rate").maybeSingle();
  return Number(data?.gst_rate ?? 18);
}
