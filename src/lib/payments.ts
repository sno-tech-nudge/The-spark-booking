import "server-only";
import { supabaseServer } from "./supabase/server";
import type { Booking } from "./types";

export const razorpayConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

/** Loads a booking owned by the signed-in caller (RLS enforces ownership). */
export async function loadOwnHeldBooking(bookingId: unknown) {
  if (typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/i.test(bookingId)) {
    return { error: "Bad booking id", status: 400 as const };
  }
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: "Please sign in", status: 401 as const };
  const { data } = await sb.from("bookings").select("*").eq("id", bookingId).eq("user_id", auth.user.id).maybeSingle();
  const booking = data as Booking | null;
  if (!booking) return { error: "Booking not found", status: 404 as const };
  return { booking, user: auth.user };
}

export async function gstRate(): Promise<number> {
  const sb = await supabaseServer();
  const { data } = await sb.from("settings").select("gst_rate").maybeSingle();
  return Number(data?.gst_rate ?? 18);
}
