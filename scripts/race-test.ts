/**
 * Load / race test against the real Supabase database.
 *
 * Opens many parallel database sessions, each acting as a different signed-in
 * person, and has them all grab a handful of seats at the same instant.
 * Passes only if no seat ends up with overlapping bookings.
 *
 *   npm run test:race              (default: 120 people, 5 seats)
 *   npm run test:race -- 300 3     (300 people fighting over 3 seats)
 *
 * Creates throwaway users race-*@spark.test and deletes them afterwards.
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

config({ path: ".env.local" });

const PEOPLE = Number(process.argv[2] ?? 120);
const SEATS = Number(process.argv[3] ?? 5);
const parts = ["morning", "afternoon", "full"] as const;

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Math.min(PEOPLE, 40),
  });

  const { rows: [{ d }] } = await pool.query<{ d: string }>(`
    select min(d)::date::text d from generate_series(public.today_ist() + 7, public.today_ist() + 14, interval '1 day') d
    where extract(isodow from d) <> 7`);
  const seats = Array.from({ length: SEATS }, (_, i) => `C-${String(20 + i).padStart(2, "0")}`);
  console.log(`${PEOPLE} people → ${SEATS} seats (${seats.join(", ")}) on ${d}, all at once…`);

  const users = Array.from({ length: PEOPLE }, (_, i) => ({ id: randomUUID(), email: `race-${i}-${Date.now()}@spark.test` }));
  try {
    for (const u of users) {
      await pool.query(
        `insert into auth.users (id, email, aud, role, instance_id, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}', '{}', now(), now())`,
        [u.id, u.email],
      );
    }
    // clear these seats for the test date first
    await pool.query(`update public.bookings set status='cancelled' where resource_id = any($1) and booking_date = $2 and status in ('held','confirmed')`, [seats, d]);

    const t0 = Date.now();
    const results = await Promise.all(users.map(async (u, i) => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
          [JSON.stringify({ sub: u.id, role: "authenticated" }), u.id]);
        await c.query("set local role authenticated");
        const seat = seats[i % SEATS];
        const part = parts[Math.floor(Math.random() * 3)];
        await c.query(`select public.book_desk($1, $2::date, $3)`, [seat, d, part]);
        await c.query("commit");
        return { ok: true as const };
      } catch (e) {
        await c.query("rollback").catch(() => {});
        return { ok: false as const, err: (e as Error).message };
      } finally {
        c.release();
      }
    }));
    const ms = Date.now() - t0;

    const wins = results.filter((r) => r.ok).length;
    const taken = results.filter((r) => !r.ok && r.err.includes("TAKEN")).length;
    const other = results.filter((r) => !r.ok && !r.err.includes("TAKEN"));
    const { rows: [{ n }] } = await pool.query<{ n: number }>(`
      select count(*)::int n from public.bookings a join public.bookings b
        on a.resource_id = b.resource_id and a.id < b.id and a.slot && b.slot
       where a.status in ('held','confirmed') and b.status in ('held','confirmed')`);

    console.log(`  ${wins} got a seat, ${taken} told "just taken", ${other.length} other errors — in ${ms} ms`);
    if (other.length) console.log("  e.g.", other[0].err);
    console.log(n === 0 ? "  ✓ PASS: zero overlapping bookings" : `  ✗ FAIL: ${n} overlapping bookings`);
    process.exitCode = n === 0 && other.length === 0 ? 0 : 1;
  } finally {
    await pool.query(`delete from auth.users where email like 'race-%@spark.test'`);
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
