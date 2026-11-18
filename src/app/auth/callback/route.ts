import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Magic-link landing: swaps the one-time code for a session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/book";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/book";

  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
