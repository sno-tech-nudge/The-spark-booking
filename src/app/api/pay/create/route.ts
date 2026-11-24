import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { gstRate, loadOwnPayable, razorpayConfigured, targetColumn } from "@/lib/payments";
import { supabaseService } from "@/lib/supabase/server";

// Starts payment for a held seat/room booking ({bookingId}) or event ticket ({rsvpId}).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await loadOwnPayable(body);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const { payable, user } = res;

  if (payable.status !== "held") {
    return NextResponse.json({ error: "This is no longer on hold" }, { status: 409 });
  }
  if (payable.hold_expires_at && new Date(payable.hold_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Your hold expired — please try again" }, { status: 409 });
  }

  const rate = await gstRate();
  const total = payable.amount + Math.round((payable.amount * rate) / 100);

  if (!razorpayConfigured) {
    return NextResponse.json({ mode: "demo", amount: total });
  }

  const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
  const order = await rzp.orders.create({
    amount: total * 100,
    currency: "INR",
    receipt: payable.id.slice(0, 40),
    notes: payable.notes,
  });
  await supabaseService().from("payments").insert({
    ...targetColumn(payable),
    user_id: user.id,
    provider: "razorpay",
    order_id: order.id,
    amount: payable.amount,
    gst_amount: total - payable.amount,
    status: "created",
  });
  return NextResponse.json({
    mode: "razorpay",
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: order.id,
    amountPaise: total * 100,
  });
}
