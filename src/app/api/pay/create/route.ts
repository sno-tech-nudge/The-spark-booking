import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { gstRate, loadOwnHeldBooking, razorpayConfigured } from "@/lib/payments";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { bookingId } = await req.json().catch(() => ({}));
  const res = await loadOwnHeldBooking(bookingId);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const { booking, user } = res;

  if (booking.status !== "held") {
    return NextResponse.json({ error: "This seat is no longer on hold" }, { status: 409 });
  }
  if (booking.hold_expires_at && new Date(booking.hold_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Your hold expired — please pick the seat again" }, { status: 409 });
  }

  const rate = await gstRate();
  const total = booking.amount + Math.round((booking.amount * rate) / 100);

  if (!razorpayConfigured) {
    return NextResponse.json({ mode: "demo", amount: total });
  }

  const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
  const order = await rzp.orders.create({
    amount: total * 100,
    currency: "INR",
    receipt: booking.id.slice(0, 40),
    notes: { booking_id: booking.id, resource: booking.resource_id, date: booking.booking_date },
  });
  await supabaseService().from("payments").insert({
    booking_id: booking.id,
    user_id: user.id,
    provider: "razorpay",
    order_id: order.id,
    amount: booking.amount,
    gst_amount: total - booking.amount,
    status: "created",
  });
  return NextResponse.json({
    mode: "razorpay",
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amountPaise: total * 100,
  });
}
