"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";
import { CornerSpark, Spinner, Wordmark } from "./brand";

/** Is "Sign in with Google" switched on in Supabase? (Auth → Providers → Google) */
async function googleEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    });
    return Boolean((await r.json())?.external?.google);
  } catch {
    return false;
  }
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function nextPath() {
  if (typeof window === "undefined") return "/book";
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/book";
}

export function LoginForm() {
  const router = useRouter();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace(nextPath());
  }, [user, router]);

  useEffect(() => {
    if (supabaseConfigured) googleEnabled().then(setGoogle);
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setError("That sign-in link didn't work (it may have expired or been opened in a different browser). Please try again.");
  }, []);

  async function withGoogle() {
    setGoogleBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setGoogleBusy(false);
      setError(error.message);
    }
    // on success the browser goes to Google, then back to /auth/callback
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath())}`,
      },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) return setError(error.message);
    router.replace(nextPath());
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-14">
      <span className="text-5xl"><Wordmark sub animated /></span>
      <div className="card mt-10 w-full p-8">
        <CornerSpark />
        <p className="font-serif text-sm italic text-spark-dark">{step === "email" ? "welcome" : "almost in"}</p>
        <h1 className="mt-1 text-2xl font-light uppercase">{step === "email" ? "Sign in or sign up" : "Check your email"}</h1>
        <p className="mt-2 text-sm text-ink/60">
          {step === "email"
            ? (google ? "One tap with Google, or we'll email you a sign-in link." : "No password needed — we'll email you a sign-in link.")
            : <>We sent a sign-in link to <b>{email}</b>. Tap it to continue, or enter the code if your email shows one.</>}
        </p>

        {!supabaseConfigured ? (
          <p className="mt-6 rounded-xl bg-cream p-3 text-sm">Sign-in isn&apos;t connected yet (Supabase keys missing).</p>
        ) : step === "email" ? (
          <>
          {google && (
            <div className="mt-6 space-y-4">
              <button
                type="button"
                onClick={withGoogle}
                disabled={googleBusy}
                className="flex w-full items-center justify-center gap-3 rounded-full border border-ink/15 bg-white px-5 py-3 font-medium text-ink shadow-sm transition hover:border-ink/40 hover:shadow disabled:opacity-60"
              >
                {googleBusy ? <Spinner className="h-5 w-5" /> : <GoogleG />}
                Continue with Google
              </button>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-ink/40">
                <span className="h-px flex-1 bg-sand" /> or use email <span className="h-px flex-1 bg-sand" />
              </div>
            </div>
          )}
          <form onSubmit={sendCode} className={google ? "mt-4 space-y-3" : "mt-6 space-y-3"}>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required autoFocus autoComplete="email" className="field"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button className="btn-spark w-full" disabled={busy}>{busy ? <><Spinner className="h-4 w-4 !text-ink" /> Sending…</> : "Email me a sign-in link"}</button>
            <p className="text-xs text-ink/50">
              Members: use the email (or Google account) the*spark team registered for you. Everyone else can book a day pass.
            </p>
          </form>
          </>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-3">
            <div>
              <label className="label" htmlFor="code">Sign-in code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus
                className="field text-center font-mono text-2xl tracking-[0.4em]" maxLength={8}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button className="btn-spark w-full" disabled={busy || code.length < 6}>{busy ? <><Spinner className="h-4 w-4 !text-ink" /> Checking…</> : "Sign in"}</button>
            <button type="button" className="w-full text-xs text-ink/50 underline" onClick={() => { setStep("email"); setCode(""); }}>
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
