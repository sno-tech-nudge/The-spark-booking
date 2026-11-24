import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { confirmFn, loadOwnPayable, resultKey, targetColumn } from "@/lib/payments";
import { supabaseService } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body as Record<string, string>;
  const res = await loadOwnPayable(body);
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  const { payable } = res;

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: "Missing payment details" }, { status: 400 });
  }
  const expected = createHmac("sha256", secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Payment signature mismatch" }, { status: 400 });
  }

  const svc = supabaseService();
  // the order must belong to this booking / ticket
  const [col, val] = Object.entries(targetColumn(payable))[0];
  const { data: pay } = await svc.from("payments").select("id").eq("order_id", razorpay_order_id).eq(col, val).maybeSingle();
  if (!pay) return NextResponse.json({ error: "Unknown order" }, { status: 400 });

  const { data, error } = await svc.rpc(confirmFn(payable), {
    p_id: payable.id, p_provider: "razorpay", p_order_id: razorpay_order_id, p_payment_id: razorpay_payment_id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ [resultKey(payable)]: data });
}
