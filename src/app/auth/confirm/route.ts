import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// Sign-in link that works on any device/browser (no PKCE verifier needed):
//   /auth/confirm?token_hash=…&type=magiclink|email|signup&next=/book
// Used by the email template once custom SMTP is set up, and by `npm run demo:login`.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  const next = url.searchParams.get("next") ?? "/book";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/book";

  if (tokenHash) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
