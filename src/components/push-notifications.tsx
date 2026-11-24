"use client";

import { useCallback, useEffect, useState } from "react";
import { SparkMark, Spinner } from "./brand";
import { useAuth } from "./auth-provider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buzz } from "@/lib/haptics";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

const listeners = new Set<() => void>();
const announce = () => listeners.forEach((l) => l());

/** Push permission + subscription state for this device, and actions to change it. */
export function usePush() {
  const { user } = useAuth();
  const [state, setState] = useState<State>("loading");

  const check = useCallback(async () => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Boolean(PUBLIC_KEY);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!supported) return setState(ios && !standalone ? "ios-install" : "unsupported");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    setState(sub && Notification.permission === "granted" ? "on" : "off");
  }, []);

  useEffect(() => {
    check();
    listeners.add(check);
    return () => { listeners.delete(check); };
  }, [check]);

  const enable = useCallback(async () => {
    if (!user) throw new Error("Please sign in first");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { await check(); throw new Error("Notifications weren't allowed"); }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PUBLIC_KEY) }));
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const sb = supabaseBrowser();
    await sb.from("push_subscriptions").delete().eq("endpoint", json.endpoint); // re-own this device if it moved accounts
    const { error } = await sb.from("push_subscriptions").insert({
      user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 200),
    });
    if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    buzz(20);
    announce();
  }, [user, check]);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabaseBrowser().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    announce();
  }, []);

  return { state, enable, disable };
}

/** Card for My bookings: switch notifications on/off and send a test. */
export function PushCard() {
  const { state, enable, disable } = usePush();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setNote(null);
    try { await fn(); if (ok) setNote(ok); } catch (e) { setNote((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="card relative overflow-hidden p-5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">Notifications</p>
      <p className="mt-1 font-medium">Nudges on your phone</p>
      <ul className="mt-2 space-y-1 text-sm text-ink/65">
        {["Your seat or room starts in 15 min", "5 minutes left in your meeting room", "Event reminders & “you're off the waitlist”", "Centre notices — e.g. Zone B closed tomorrow"].map((x) => (
          <li key={x} className="flex gap-2"><SparkMark className="mt-1 h-3 w-3 shrink-0 text-spark" />{x}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {state === "loading" ? <Spinner className="h-5 w-5" />
          : state === "on" ? (
            <>
              <span className="chip bg-spark text-ink">On for this device</span>
              <button className="btn-ghost" disabled={busy} onClick={() => run(async () => {
                const r = await fetch("/api/push/test", { method: "POST" });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error ?? "Couldn't send");
              }, "Sent — check your notifications")}>Send me a test</button>
              <button className="text-xs text-ink/50 underline" disabled={busy} onClick={() => run(disable)}>Turn off</button>
            </>
          ) : state === "off" ? (
            <button className="btn-spark" disabled={busy} onClick={() => run(enable, "Done! We'll nudge you before your bookings.")}>
              {busy ? <><Spinner className="h-4 w-4 !text-ink" /> Turning on…</> : "Turn on notifications"}
            </button>
          ) : state === "ios-install" ? (
            <p className="rounded-xl bg-cream px-3 py-2 text-sm">On iPhone, first add the app to your Home Screen (Share → <b>Add to Home Screen</b>), open it from there, then turn notifications on.</p>
          ) : state === "denied" ? (
            <p className="rounded-xl bg-cream px-3 py-2 text-sm">Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.</p>
          ) : (
            <p className="rounded-xl bg-cream px-3 py-2 text-sm">This browser can&apos;t show notifications. Try Chrome on Android or the installed app.</p>
          )}
      </div>
      {note && <p className="mt-2 text-xs text-ink/60">{note}</p>}
    </div>
  );
}

/** Small "Remind me 15 min before" button for confirmation screens (hidden when not useful). */
export function PushNudge({ label = "Remind me on my phone" }: { label?: string }) {
  const { state, enable } = usePush();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (state !== "off" || done) return null;
  return (
    <button
      className="btn-ghost w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await enable(); setDone(true); } catch { /* user said no */ }
        setBusy(false);
      }}
    >
      {busy ? <Spinner className="h-4 w-4" /> : <SparkMark className="h-4 w-4 text-spark" />} {label}
    </button>
  );
}
