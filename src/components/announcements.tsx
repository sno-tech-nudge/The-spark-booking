"use client";

import { useCallback, useEffect, useState } from "react";
import { SparkMark } from "./brand";
import { useCatalog, useMounted } from "@/lib/hooks";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { closureScope, type Announcement } from "@/lib/announcements";
import { fmtDate, istNow, toISODate, todayIST } from "@/lib/time";

let cache: Announcement[] | null = null;
const subscribers = new Set<(a: Announcement[]) => void>();
let channelStarted = false;

async function fetchAnnouncements() {
  const { data } = await supabaseBrowser()
    .from("announcements").select("*").eq("active", true)
    .gte("ends_on", todayIST()).order("starts_on").limit(50);
  cache = (data as Announcement[]) ?? [];
  subscribers.forEach((fn) => fn(cache!));
}

/** Active (current and upcoming) notices; updates live when staff post or edit one. */
export function useAnnouncements() {
  const [list, setList] = useState<Announcement[]>(cache ?? []);
  const reload = useCallback(() => fetchAnnouncements(), []);
  useEffect(() => {
    if (!supabaseConfigured) return;
    subscribers.add(setList);
    if (!cache) fetchAnnouncements();
    if (!channelStarted) {
      channelStarted = true;
      supabaseBrowser()
        .channel("announcements")
        .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => fetchAnnouncements())
        .subscribe();
    }
    return () => { subscribers.delete(setList); };
  }, []);
  return { announcements: list, reload };
}

export function dateRange(a: Pick<Announcement, "starts_on" | "ends_on">) {
  return a.starts_on === a.ends_on ? fmtDate(a.starts_on) : `${fmtDate(a.starts_on)} – ${fmtDate(a.ends_on)}`;
}

const DISMISS_KEY = "spark:dismissed-notices";
function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]"); } catch { return []; }
}

/** Site-wide strip for notices happening now or within the next two weeks. */
export function AnnouncementBanner() {
  const mounted = useMounted();
  const { announcements } = useAnnouncements();
  const { catalog } = useCatalog();
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => { setDismissed(readDismissed()); }, []);
  if (!mounted) return null;

  const today = todayIST();
  const h = istNow();
  h.setDate(h.getDate() + 14);
  const horizon = toISODate(h);
  const shown = announcements
    .filter((a) => a.starts_on <= horizon && a.ends_on >= today && !dismissed.includes(a.id))
    .slice(0, 2);
  if (!shown.length) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-50))); } catch {}
  };

  return (
    <div className="border-b border-sand/70">
      {shown.map((a) => {
        const now = a.starts_on <= today;
        const closing = a.closure !== "none";
        const name = catalog?.resources.find((r) => r.id === a.resource_id)?.name;
        return (
          <div key={a.id} className={closing ? "bg-spark-light/70" : "bg-spark-pale"}>
            <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2 text-sm">
              <SparkMark className="mt-0.5 h-4 w-4 shrink-0 text-spark-dark" />
              <p className="min-w-0 flex-1">
                <span className="font-medium">{a.message}</span>
                <span className="text-ink/60">
                  {" · "}{now && a.starts_on === a.ends_on ? "Today" : dateRange(a)}
                  {closing && ` · ${closureScope(a, name)} — no bookings`}
                </span>
              </p>
              <button onClick={() => dismiss(a.id)} className="shrink-0 text-ink/40 hover:text-ink" aria-label="Dismiss notice">✕</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
