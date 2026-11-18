"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";
import type { Booking } from "@/lib/types";
import { inr } from "@/lib/time";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/** Pays for a held seat. Collects (and saves) the visitor's details first. */
export function Checkout({
  booking, gstRate, title, onPaid, onCancel,
}: {
  booking: Booking;
  gstRate: number;
  title: string;
  onPaid: (b: Booking) => void;
  onCancel: () => void;
}) {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [org, setOrg] = useState(profile?.organisation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(() => secondsLeft(booking.hold_expires_at));

  useEffect(() => {
    const t = setInterval(() => setLeft(secondsLeft(booking.hold_expires_at)), 1000);
    return () => clearInterval(t);
  }, [booking.hold_expires_at]);

  const gst = Math.round((booking.amount * gstRate) / 100);
  const total = booking.amount + gst;
  const expired = left <= 0;

  async function pay() {
    if (!name.trim() || !/^[+\d][\d\s-]{7,}$/.test(phone.trim())) {
      setError("Please add your name and a valid phone number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // save their details for next time
      await supabaseBrowser().from("profiles").update({
        full_name: name.trim(), phone: phone.trim(), organisation: org.trim() || null,
      }).eq("id", user!.id);
      refreshProfile();

      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      const order = await res.json();
      if (!res.ok) throw new Error(order.error ?? "Could not start payment");

      if (order.mode === "demo") {
        const r = await fetch("/api/pay/demo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookingId: booking.id }),
        });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error ?? "Payment failed");
        onPaid(out.booking);
        return;
      }

      if (!(await loadRazorpay()) || !window.Razorpay) throw new Error("Couldn't load Razorpay checkout");
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: "INR",
        name: "the*spark centre",
        description: title,
        prefill: { name, email: user?.email, contact: phone },
        theme: { color: "#ffa927" },
        handler: async (resp: Record<string, string>) => {
          const r = await fetch("/api/pay/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bookingId: booking.id, ...resp }),
          });
          const out = await r.json();
          if (!r.ok) {
            setError(out.error ?? "Payment could not be verified");
            setBusy(false);
            return;
          }
          onPaid(out.booking);
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-cream px-4 py-3">
        <div>
          <p className="text-xs text-ink/60">Seat held for you</p>
          <p className="font-semibold">{title}</p>
        </div>
        <div className={`text-right font-mono text-lg font-semibold ${left < 60 ? "text-red-600" : ""}`}>
          {expired ? "expired" : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
        </div>
      </div>

      {expired ? (
        <div className="space-y-3">
          <p className="text-sm text-ink/70">Your hold ran out and the seat was released. Pick a seat again.</p>
          <button className="btn-ink w-full" onClick={onCancel}>Back to the map</button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Full name *</label>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91" />
            </div>
            <div>
              <label className="label">Organisation</label>
              <input className="field" value={org} onChange={(e) => setOrg(e.target.value)} />
            </div>
          </div>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink/60">Day pass</dt><dd>{inr(booking.amount)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/60">GST {gstRate}%</dt><dd>{inr(gst)}</dd></div>
            <div className="flex justify-between border-t border-ink/10 pt-2 font-semibold"><dt>Total</dt><dd>{inr(total)}</dd></div>
          </dl>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onCancel} disabled={busy}>Release seat</button>
            <button className="btn-spark flex-1" onClick={pay} disabled={busy}>
              {busy ? "Processing…" : `Pay ${inr(total)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function secondsLeft(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}
