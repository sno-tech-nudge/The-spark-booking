/**
 * Race test through the real public API (the same path the app uses).
 * N signed-in people all try to book the SAME seat at the same instant,
 * then a second round where they spread over 3 seats with random slots.
 *
 *   npm run test:race:api            (default 24 people — Supabase limits sign-ins per IP)
 *   npm run test:race:api -- 20
 *
 * Creates throwaway users race-api-*@spark.test and deletes them afterwards.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const N = Number(process.argv[2] ?? 24);
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function main() {
  const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
  const stamp = Date.now();
  const ids: string[] = [];
  const clients: SupabaseClient[] = [];

  try {
    process.stdout.write(`Signing in ${N} test people`);
    for (let i = 0; i < N; i++) {
      const email = `race-api-${i}-${stamp}@spark.test`;
      const { data: u, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (ce) throw ce;
      ids.push(u.user.id);
      const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (le) throw le;
      const c = createClient(URL_, ANON, opts);
      const { error: ve } = await c.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
      if (ve) throw new Error(`sign-in ${i}: ${ve.message}`);
      clients.push(c);
      process.stdout.write(".");
    }
    console.log(" done");

    // a weekday ~10 days out
    const d = new Date(Date.now() + 10 * 86400_000);
    if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);

    // Round 1: everyone, one seat, full day, same instant
    let t0 = Date.now();
    const r1 = await Promise.all(clients.map((c) => c.rpc("book_desk", { p_resource_id: "B-20", p_date: date, p_part: "full" })));
    const wins1 = r1.filter((r) => !r.error).length;
    const taken1 = r1.filter((r) => r.error?.message.includes("TAKEN")).length;
    console.log(`Round 1: ${N} people → seat B-20, ${date}, full day, all at once (${Date.now() - t0} ms)`);
    console.log(`  ${wins1} got it, ${taken1} told "just taken", ${N - wins1 - taken1} other`);
    const other1 = r1.find((r) => r.error && !r.error.message.includes("TAKEN"));
    if (other1) console.log("  e.g.", other1.error!.message);

    // Round 2: three seats, random morning/afternoon/full
    const parts = ["morning", "afternoon", "full"];
    const seats = ["B-21", "B-22", "B-23"];
    t0 = Date.now();
    const r2 = await Promise.all(clients.map((c, i) =>
      c.rpc("book_desk", { p_resource_id: seats[i % 3], p_date: date, p_part: parts[Math.floor(Math.random() * 3)] })));
    const wins2 = r2.filter((r) => !r.error).length;
    console.log(`Round 2: ${N} people → 3 seats, random slots (${Date.now() - t0} ms): ${wins2} bookings made`);

    // Verify: no overlapping live bookings on those seats
    const { data: rows } = await admin.from("bookings").select("resource_id, part, status")
      .in("resource_id", ["B-20", ...seats]).eq("booking_date", date).in("status", ["held", "confirmed"]);
    let overlaps = 0;
    const by = new Map<string, string[]>();
    for (const r of rows ?? []) by.set(r.resource_id, [...(by.get(r.resource_id) ?? []), r.part]);
    for (const [, ps] of by) {
      const full = ps.filter((p) => p === "full").length;
      const am = ps.filter((p) => p === "morning").length;
      const pm = ps.filter((p) => p === "afternoon").length;
      if (full > 1 || (full === 1 && am + pm > 0) || am > 1 || pm > 1) overlaps++;
    }
    for (const [seat, ps] of [...by.entries()].sort()) console.log(`  ${seat}: ${ps.join(" + ")}`);
    const ok = wins1 === 1 && overlaps === 0;
    console.log(ok ? "✓ PASS: exactly one winner in round 1, zero overlapping bookings" : `✗ FAIL (round-1 winners ${wins1}, seats with overlaps ${overlaps})`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    for (const id of ids) await admin.auth.admin.deleteUser(id);
    console.log(`Cleaned up ${ids.length} test people and their bookings.`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
