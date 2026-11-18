"use client";

import { supabaseConfigured } from "@/lib/supabase/client";

export function SetupBanner() {
  if (supabaseConfigured) return null;
  return (
    <div className="bg-ink px-4 py-2 text-center text-xs text-paper">
      Setup needed: add <code className="text-spark">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
      <code className="text-spark">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see README) — booking is disabled until then.
    </div>
  );
}
