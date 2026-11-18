import { NextResponse } from "next/server";
import { loadOwnHeldBooking, razorpayConfigured } from "@/lib/payments";
import { supabaseService } from "@/lib/supabase/server";

// Prototype-only: simulates a successful payment while Razorpay keys aren't set.
export async function POST(req: Request) {
  if (razorpayConfigured) {
    return NextResponse.json({ error: "Demo payments are off once Razorpay is configured" }, { status: 403 });
  }
  const { bookingId } = await req.json().catch(() => ({}));
  const res = await loadOwnHeldBooking(bookingId);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  const ref = `demo_${Date.now().toString(36)}`;
  const { data, error } = await supabaseService().rpc("confirm_paid_booking", {
    p_id: res.booking.id, p_provider: "demo", p_order_id: ref, p_payment_id: ref,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ booking: data });
}
