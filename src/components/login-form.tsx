"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser, supabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "./auth-provider";
import { Logo } from "./site-header";

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

  useEffect(() => {
    if (user) router.replace(nextPath());
  }, [user, router]);

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
    <div className="mx-auto flex max-w-md flex-col px-4 py-16">
      <div className="card p-8">
        <Logo className="text-2xl" />
        <h1 className="mt-6 text-xl font-semibold">{step === "email" ? "Sign in or sign up" : "Check your email"}</h1>
        <p className="mt-1 text-sm text-ink/60">
          {step === "email"
            ? "No password needed. We'll email you a sign-in code."
            : <>We sent a code and a sign-in link to <b>{email}</b>. Enter the code, or just tap the link.</>}
        </p>

        {!supabaseConfigured ? (
          <p className="mt-6 rounded-xl bg-cream p-3 text-sm">Sign-in isn&apos;t connected yet (Supabase keys missing).</p>
        ) : step === "email" ? (
          <form onSubmit={sendCode} className="mt-6 space-y-3">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" required autoFocus autoComplete="email" className="field"
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button className="btn-spark w-full" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
            <p className="text-xs text-ink/50">
              Members: use the email the*spark team registered for you. Everyone else can book a day pass.
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-6 space-y-3">
            <div>
              <label className="label" htmlFor="code">Sign-in code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus
                className="field text-center font-mono text-2xl tracking-[0.4em]" maxLength={8}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button className="btn-spark w-full" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
            <button type="button" className="w-full text-xs text-ink/50 underline" onClick={() => { setStep("email"); setCode(""); }}>
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
