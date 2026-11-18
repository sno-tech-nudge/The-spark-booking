"use client";

import { useEffect, useState } from "react";
import { SparkMark } from "./brand";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();

/** Registers the service worker (production only) and captures the install prompt. */
export function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred = e as BIPEvent;
      listeners.forEach((l) => l());
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  return null;
}

function useInstallState() {
  const [state, setState] = useState<{ installed: boolean; canPrompt: boolean; ios: boolean } | null>(null);
  useEffect(() => {
    const compute = () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      setState({ installed: standalone, canPrompt: Boolean(deferred), ios });
    };
    compute();
    listeners.add(compute);
    return () => { listeners.delete(compute); };
  }, []);
  return state;
}

async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice;
  deferred = null;
  listeners.forEach((l) => l());
}

/** "Add the*spark to your home screen" — Android/desktop prompt, iPhone instructions. */
export function InstallCard() {
  const s = useInstallState();
  if (!s) return null;
  return (
    <div className="card relative overflow-hidden p-5">
      <SparkMark className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 text-spark/20 spark-spin [animation-duration:20s]" />
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink/55">the*spark app</p>
      {s.installed ? (
        <>
          <p className="mt-1 font-medium">You&apos;re using the app</p>
          <p className="mt-1 text-sm text-ink/60">Open it from your home screen any time.</p>
        </>
      ) : (
        <>
          <p className="mt-1 font-medium">Add to your home screen</p>
          <p className="mt-1 text-sm text-ink/60">
            One tap to book, full-screen like an app, with the*spark asterisk as its icon.
          </p>
          {s.canPrompt ? (
            <button className="btn-spark mt-4" onClick={promptInstall}>Install the app</button>
          ) : s.ios ? (
            <p className="mt-3 rounded-xl bg-cream px-3 py-2 text-sm">
              In Safari, tap <b>Share</b> <span aria-hidden>⬆︎</span> then <b>Add to Home Screen</b>.
            </p>
          ) : (
            <p className="mt-3 rounded-xl bg-cream px-3 py-2 text-sm">
              In your browser menu, choose <b>Install app</b> or <b>Add to Home screen</b>.
            </p>
          )}
        </>
      )}
    </div>
  );
}
