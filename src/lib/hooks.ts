"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser, supabaseConfigured } from "./supabase/client";
import type { Occupancy, Plan, Resource, Settings, Usage } from "./types";

export type Catalog = { resources: Resource[]; plans: Plan[]; settings: Settings | null };

let catalogCache: Catalog | null = null;

/** Seats, rooms, plans and prices (rarely change; cached per tab). */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(catalogCache);
  const reload = useCallback(async () => {
    const sb = supabaseBrowser();
    const [r, p, s] = await Promise.all([
      sb.from("resources").select("*").eq("is_active", true).order("sort"),
      sb.from("plans").select("*").order("sort"),
      sb.from("settings").select("*").maybeSingle(),
    ]);
    catalogCache = {
      resources: (r.data as Resource[]) ?? [],
      plans: (p.data as Plan[]) ?? [],
      settings: (s.data as Settings) ?? null,
    };
    setCatalog(catalogCache);
  }, []);
  useEffect(() => {
    if (!supabaseConfigured) return;
    if (!catalogCache) reload();
  }, [reload]);
  return { catalog, reload };
}

/**
 * Live view of who-holds-what for one date. Loads the current state, then
 * applies every change pushed over Supabase Realtime. Re-syncs on reconnect
 * and when the tab becomes visible again, so it can't drift.
 */
export function useLiveOccupancy(date: string | null) {
  const [rows, setRows] = useState<Map<string, Occupancy>>(new Map());
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  const load = useCallback(async () => {
    if (!dateRef.current) return;
    const { data } = await supabaseBrowser().from("occupancy").select("*").eq("booking_date", dateRef.current);
    const m = new Map<string, Occupancy>();
    (data as Occupancy[] | null)?.forEach((o) => m.set(o.booking_id, o));
    setRows(m);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured || !date) return;
    load();
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`occupancy-${date}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "occupancy" }, (payload) => {
        const rec = (payload.eventType === "DELETE" ? payload.old : payload.new) as Partial<Occupancy>;
        if (!rec?.booking_id) return;
        setRows((prev) => {
          const next = new Map(prev);
          if (payload.eventType === "DELETE") {
            const gone = next.get(rec.booking_id!);
            next.delete(rec.booking_id!);
            if (gone) pulse(gone.resource_id);
          } else if (rec.booking_date === dateRef.current) {
            next.set(rec.booking_id!, rec as Occupancy);
            pulse(rec.resource_id!);
          }
          return next;
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLive("live");
          load();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLive("offline");
        }
      });

    function pulse(resourceId: string) {
      setFlash((f) => new Set(f).add(resourceId));
      setTimeout(() => setFlash((f) => {
        const n = new Set(f);
        n.delete(resourceId);
        return n;
      }), 600);
    }

    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(channel);
    };
  }, [date, load]);

  // Holds lapse on the clock; re-check every 10s so expired holds show as free.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const active = [...rows.values()].filter(
    (o) => !(o.status === "held" && o.hold_expires_at && new Date(o.hold_expires_at).getTime() < now),
  );
  return { occupancy: active, live, flash, reload: load, now };
}

export function useUsage(enabled: boolean) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const reload = useCallback(async () => {
    const { data } = await supabaseBrowser().rpc("my_usage");
    setUsage((data as Usage) ?? null);
  }, []);
  useEffect(() => {
    if (enabled) reload();
    else setUsage(null);
  }, [enabled, reload]);
  return { usage, reload };
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Current time, ticking (client only; null until mounted). */
export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
