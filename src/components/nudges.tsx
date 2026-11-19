"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SparkMark } from "./brand";
import { useCatalog, useLiveOccupancy, useMounted } from "@/lib/hooks";
import { buzz } from "@/lib/haptics";
import { closedOn } from "@/lib/announcements";
import { useAnnouncements } from "./announcements";
import { istNow, openDays, toISODate, todayIST } from "@/lib/time";

/** Next open day after today (skips Sundays). */
function nextOpenDay() {
  const today = todayIST();
  return openDays(3).find((d) => d.date > today) ?? null;
}

/** "Tomorrow is 84% full — 20 seats left. Book now" when the next open day is busy. */
export function BusyNudge({ onPick }: { onPick?: (date: string) => void }) {
  const mounted = useMounted();
  const next = mounted ? nextOpenDay() : null;
  const { catalog } = useCatalog();
  const { occupancy } = useLiveOccupancy(next?.date ?? null);
  const { announcements } = useAnnouncements();
  if (!next || !catalog) return null;

  // only seats people could actually book that day (closures and fixed desks excluded)
  const closed = closedOn(announcements, next.date, catalog.resources);
  const desks = catalog.resources.filter((r) => r.kind === "desk" && !closed.has(r.id) && !r.assigned_membership);
  if (!desks.length) return null; // the whole floor is closed — the notice banner says so
  const deskIds = new Set(desks.map((d) => d.id));
  const used = occupancy
    .filter((o) => deskIds.has(o.resource_id) && o.kind === "desk")
    .reduce((s, o) => s + (o.part === "full" ? 1 : 0.5), 0);
  const pct = Math.round((used / desks.length) * 100);
  const threshold = catalog.settings?.busy_nudge_pct ?? 80;
  if (pct < threshold) return null;

  const t = istNow();
  t.setDate(t.getDate() + 1);
  const isTomorrow = next.date === toISODate(t);
  const label = isTomorrow ? "Tomorrow" : new Date(`${next.date}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
  const left = Math.max(0, Math.floor(desks.length - used));

  const inner = (
    <>
      <SparkMark className="h-5 w-5 shrink-0 text-ink spark-spin [animation-duration:3s]" />
      <span className="min-w-0 flex-1">
        <b>{label} is {pct}% full</b> — only {left} seat{left === 1 ? "" : "s"} left.
      </span>
      <span className="shrink-0 rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper">Book now →</span>
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-2xl bg-spark px-4 py-3 text-left text-sm text-ink shadow-sm transition hover:bg-spark-dark";
  return onPick
    ? <button className={cls} onClick={() => onPick(next.date)}>{inner}</button>
    : <Link className={cls} href={`/book?date=${next.date}`}>{inner}</Link>;
}

/**
 * Pull down from the top of the page to refresh (phones / installed app).
 * Shows the asterisk turning as you pull, then spinning while it refreshes.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown> | void; children: React.ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const TRIGGER = 70;

  useEffect(() => {
    const prev = document.documentElement.style.overscrollBehaviorY;
    document.documentElement.style.overscrollBehaviorY = "contain";
    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && !refreshing ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      pullRef.current = dy > 0 ? Math.min(dy * 0.5, 110) : 0;
      setPull(pullRef.current);
    };
    const onEnd = async () => {
      if (start.current === null) return;
      start.current = null;
      if (pullRef.current >= TRIGGER) {
        setRefreshing(true);
        setPull(56);
        buzz(15);
        try { await onRefresh(); } finally {
          setTimeout(() => { setRefreshing(false); setPull(0); }, 400);
        }
      } else {
        setPull(0);
      }
      pullRef.current = 0;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      document.documentElement.style.overscrollBehaviorY = prev;
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [onRefresh, refreshing]);

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center overflow-hidden transition-[height] duration-200"
        style={{ height: pull }}
        aria-hidden={!refreshing}
      >
        {pull > 0 && (
          <span className="mt-3 grid h-9 w-9 place-items-center rounded-full bg-white shadow-md ring-1 ring-sand">
            <SparkMark
              className={`h-5 w-5 ${pull >= TRIGGER || refreshing ? "text-spark" : "text-ink/30"} ${refreshing ? "spark-spin" : ""}`}
              title={refreshing ? "Refreshing" : undefined}
            />
          </span>
        )}
      </div>
      <div style={{ transform: pull ? `translateY(${pull}px)` : undefined }} className="transition-transform duration-200">
        {children}
      </div>
    </div>
  );
}
