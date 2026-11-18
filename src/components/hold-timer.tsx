"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { SparkMark } from "./brand";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { PARTS, fmtDate } from "@/lib/time";
import type { Booking } from "@/lib/types";

export const HOLD_EVENT = "spark:hold-changed";
export const announceHoldChange = () => window.dispatchEvent(new Event(HOLD_EVENT));

/** Seconds left until `iso`, ticking every second. */
export function useCountdown(iso: string | null | undefined) {
  const calc = useCallback(() => (iso ? Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)) : 0), [iso]);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
  }, [calc]);
  return left;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** BookMyShow-style "complete your booking in 09:41" with a draining bar. */
export function HoldTimer({ expiresAt, totalMinutes = 10, label = "Complete your booking in" }: {
  expiresAt: string | null; totalMinutes?: number; label?: string;
}) {
  const left = useCountdown(expiresAt);
  if (left === null) return null;
  const pct = Math.max(0, Math.min(100, (left / (totalMinutes * 60)) * 100));
  const urgent = left < 120;
  return (
    <div className={`overflow-hidden rounded-2xl ${urgent ? "bg-red-50" : "bg-spark-pale"}`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm">
          <SparkMark className={`h-4 w-4 ${urgent ? "text-red-600" : "text-spark-dark"} spark-spin`} />
          {left > 0 ? label : "Time's up — the seat has been released"}
        </span>
        <span className={`font-mono text-xl font-medium tabular-nums ${urgent ? "text-red-600" : ""}`}>{mmss(left)}</span>
      </div>
      <div className="h-1 bg-ink/5">
        <div className={`h-full transition-[width] duration-1000 ease-linear ${urgent ? "bg-red-500" : "bg-spark"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** App-wide strip: "Seat A-02 held for you · 08:41 · Complete booking →" */
export function HoldBanner() {
  const { user } = useAuth();
  const path = usePathname();
  const [hold, setHold] = useState<Booking | null>(null);

  const load = useCallback(async () => {
    if (!user || !supabaseConfigured) return setHold(null);
    const { data } = await supabaseBrowser()
      .from("bookings").select("*").eq("user_id", user.id).eq("status", "held")
      .gt("hold_expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    setHold((data as Booking) ?? null);
  }, [user]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener(HOLD_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(t);
      window.removeEventListener(HOLD_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const left = useCountdown(hold?.hold_expires_at);
  if (!hold || left === null || left <= 0 || path.startsWith("/book")) return null;
  const part = PARTS.find((p) => p.id === hold.part);
  return (
    <Link href="/book" className="block bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
        <SparkMark className="h-4 w-4 shrink-0 text-spark spark-spin" />
        <span className="min-w-0 flex-1 truncate">
          Seat <b>{hold.resource_id}</b> held for you · {fmtDate(hold.booking_date)} · {part?.label}
        </span>
        <span className={`font-mono tabular-nums ${left < 120 ? "text-red-400" : "text-spark"}`}>{mmss(left)}</span>
        <span className="hidden rounded-full bg-spark px-3 py-0.5 text-xs font-medium text-ink sm:inline">Complete booking →</span>
      </div>
    </Link>
  );
}
