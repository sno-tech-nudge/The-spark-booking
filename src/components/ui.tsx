"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./brand";

/** The rotating asterisk, centred, with an optional caption. Use for any loading state. */
export function Loader({ label, className = "py-16" }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`} role="status" aria-live="polite">
      <Spinner className="h-10 w-10" />
      {label && <p className="text-[11px] uppercase tracking-[0.14em] text-ink/50">{label}</p>}
    </div>
  );
}

export function DateStrip({
  days, value, onChange,
}: {
  days: { date: string; dow: string; day: string; month: string }[];
  value: string | null;
  onChange: (d: string) => void;
}) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {days.length === 0
        ? <div className="flex h-[68px] w-full items-center justify-center"><Spinner className="h-6 w-6" /></div>
        : days.map((d, i) => {
            const active = d.date === value;
            return (
              <button
                key={d.date}
                onClick={() => onChange(d.date)}
                className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 transition ${
                  active ? "border-ink bg-ink text-paper shadow-md" : "border-sand bg-white/80 hover:border-spark"
                }`}
              >
                <span className={`text-[10px] uppercase ${active ? "text-spark" : "text-ink/50"}`}>{i === 0 ? "Today" : d.dow}</span>
                <span className="text-xl font-light leading-tight">{d.day}</span>
                <span className="text-[10px] opacity-60">{d.month}</span>
              </button>
            );
          })}
    </div>
  );
}

export function LiveBadge({ state }: { state: "connecting" | "live" | "offline" }) {
  const map = {
    live: { dot: "bg-spark live-dot", text: "Live — updates instantly" },
    connecting: { dot: "bg-held", text: "Connecting…" },
    offline: { dot: "bg-red-500", text: "Reconnecting…" },
  }[state];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs text-ink/70">
      <span className={`h-2 w-2 rounded-full ${map.dot}`} />
      {map.text}
    </span>
  );
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-ink/30 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div
        role="dialog"
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-lg rounded-t-3xl bg-white p-6 shadow-2xl transition-transform duration-300 sm:bottom-6 sm:rounded-3xl ${
          open ? "translate-y-0" : "translate-y-[110%]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

type ToastT = { id: number; text: string; tone: "ok" | "warn" | "error" } | null;

export function useToast() {
  const [toast, setToast] = useState<ToastT>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, tone: "ok" | "warn" | "error" = "ok") => {
    setToast({ id: Date.now(), text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastT }) {
  if (!toast) return null;
  const tone = { ok: "bg-ink text-paper", warn: "bg-held text-ink", error: "bg-red-600 text-white" }[toast.tone];
  return (
    <div key={toast.id} className={`fixed left-1/2 top-20 z-[60] -translate-x-1/2 rounded-full px-5 py-2.5 text-sm shadow-lg ${tone}`}>
      {toast.text}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-[10px] uppercase tracking-[0.12em] text-ink/55">{label}</p>
      <p className="mt-2 text-3xl font-light tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink/50">{sub}</p>}
    </div>
  );
}

export function Meter({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-ink/10">
      <div className={`h-full rounded-full ${used > total ? "bg-red-500" : "bg-spark"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
