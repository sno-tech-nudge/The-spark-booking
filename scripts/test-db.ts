/**
 * Runs the real migration + seed inside an in-memory Postgres (PGlite) with a
 * tiny stand-in for Supabase's auth schema, then checks the booking rules.
 *
 *   npm run test:db
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = join(__dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/0001_init.sql"), "utf8");
const grants = readFileSync(join(root, "supabase/migrations/0002_grants.sql"), "utf8");
const m3 = readFileSync(join(root, "supabase/migrations/0003_hold_and_calendar.sql"), "utf8");
const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8");

let passed = 0;
let failed = 0;
function ok(cond: unknown, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  const db = new PGlite({ extensions: { btree_gist } });

  // Minimal Supabase look-alike
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
  `);
  await db.exec(migration);
  await db.exec(seed);
  await db.exec(grants);
  await db.exec(m3);

  const as = async (uid: string | null) => {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  };
  const user = async (email: string) => {
    const id = randomUUID();
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    return id;
  };
  const rpc = async (sql: string, params: unknown[]) => {
    try {
      const r = await db.query<Record<string, unknown>>(sql, params);
      return { row: r.rows[0], error: null as string | null };
    } catch (e) {
      return { row: null, error: (e as Error).message };
    }
  };
  const bookDesk = (seat: string, date: string, part: string) =>
    rpc(`select * from public.book_desk($1, $2::date, $3)`, [seat, date, part]);
  const bookRoom = (room: string, date: string, hour: number, hours: number) =>
    rpc(
      `select * from public.book_room($1, public.ist($2::date, $3), $4)`,
      [room, date, hour, hours],
    );

  // Pick two open days (Mon–Sat) in the same month, from tomorrow on.
  const { rows: dayRows } = await db.query<{ d: string }>(`
    select d::date::text as d from generate_series(public.today_ist() + 1, public.today_ist() + 28, interval '1 day') d
    where extract(isodow from d) <> 7 order by d`);
  const days = dayRows.map((r) => r.d);
  let d1 = days[0];
  let d2 = days[1];
  for (let i = 0; i < days.length - 1; i++) {
    if (days[i].slice(0, 7) === days[i + 1].slice(0, 7)) {
      d1 = days[i];
      d2 = days[i + 1];
      break;
    }
  }
  console.log(`Test dates: ${d1}, ${d2}\n`);

  // People
  await db.exec(`insert into public.admin_emails values ('staff@spark.test')`);
  const admin = await user("staff@spark.test");
  await db.exec(`insert into public.memberships (email, plan_id) values ('flexi@spark.test', 'flexi')`);
  const flexi = await user("flexi@spark.test"); // signs up after being invited
  const limited = await user("limited@spark.test");
  await db.exec(`insert into public.memberships (email, plan_id) values ('limited@spark.test', 'limited')`);
  const guest = await user("guest@spark.test");
  const guest2 = await user("guest2@spark.test");
  const fixed = await user("fixed@spark.test");
  await db.exec(`insert into public.memberships (email, plan_id, assigned_seat_id) values ('fixed@spark.test', 'fixed', 'D-31')`);

  console.log("Seed & roles");
  const counts = await db.query<{ desks: number; rooms: number }>(
    `select count(*) filter (where kind='desk')::int desks, count(*) filter (where kind='room')::int rooms from public.resources`,
  );
  ok(counts.rows[0].desks === 127, "127 desks seeded");
  ok(counts.rows[0].rooms === 10, "10 rooms / booths seeded");
  const roles = await db.query<{ email: string; role: string }>(`select email, role from public.profiles order by email`);
  const roleOf = Object.fromEntries(roles.rows.map((r) => [r.email, r.role]));
  ok(roleOf["staff@spark.test"] === "admin", "admin email becomes admin on sign-up");
  ok(roleOf["flexi@spark.test"] === "member", "invited member is linked on sign-up");
  ok(roleOf["limited@spark.test"] === "member", "member added after sign-up is promoted");
  ok(roleOf["guest@spark.test"] === "guest", "public sign-up is a guest");

  console.log("\nDesks: no double booking");
  await as(flexi);
  let r = await bookDesk("A-01", d1, "full");
  ok(r.row?.status === "confirmed" && r.row?.billing === "included", "member books A-01 full day (included)");
  await as(guest);
  r = await bookDesk("A-01", d1, "morning");
  ok(r.error?.includes("TAKEN"), "guest cannot take A-01 morning (full day already booked)");
  r = await bookDesk("A-02", d1, "morning");
  ok(r.row?.status === "held" && Number(r.row?.amount) === 300, "guest holds A-02 morning, ₹300 to pay");
  const holdMins = (new Date(String(r.row?.hold_expires_at)).getTime() - Date.now()) / 60000;
  ok(holdMins > 9.5 && holdMins <= 10.01, `seat is held for 10 minutes (${holdMins.toFixed(2)})`);
  const guestHold = r.row?.id as string;
  await as(limited);
  r = await bookDesk("A-02", d1, "afternoon");
  ok(r.row?.status === "confirmed", "someone else can book A-02 afternoon (no overlap)");
  await as(flexi);
  r = await bookDesk("A-02", d1, "full");
  ok(r.error?.includes("TAKEN"), "A-02 full day is refused (overlaps both halves)");
  r = await bookDesk("B-05", d1, "afternoon");
  ok(r.error?.includes("ALREADY_HAVE_DESK"), "member can't hold two desks at the same time");
  await as(guest2);
  r = await bookDesk("D-31", d1, "full");
  ok(r.error?.includes("SEAT_ASSIGNED"), "fixed-desk seat D-31 is reserved for its holder");
  await as(fixed);
  r = await bookDesk("D-31", d1, "full");
  ok(r.row?.status === "confirmed", "fixed-desk holder can use D-31");

  console.log("\nHolds expire and free the seat");
  await db.query(`update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [guestHold]);
  await as(guest2);
  r = await bookDesk("A-02", d1, "morning");
  ok(r.row?.status === "held", "lapsed hold is released; another guest can hold A-02 morning");
  await as(null);
  r = await rpc(`select * from public.confirm_paid_booking($1, 'demo', 'o1', 'p1')`, [guestHold]);
  ok(r.row?.billing === "refund_due", "late payment on a lost seat is flagged refund_due, not double booked");
  const guest2Hold = (await db.query<{ id: string }>(
    `select id from public.bookings where user_id = $1 and status = 'held'`, [guest2])).rows[0].id;
  r = await rpc(`select * from public.confirm_paid_booking($1, 'demo', 'o2', 'p2')`, [guest2Hold]);
  ok(r.row?.status === "confirmed" && r.row?.billing === "paid", "paid hold becomes a confirmed booking");

  console.log("\nLimited plan overage");
  await db.exec(`update public.plans set desk_days_included = 1 where id = 'limited'`);
  await as(limited);
  r = await bookDesk("C-01", d1, "morning");
  ok(r.row?.billing === "included", "limited: morning uses 0.5 of 1 day (A-02 pm already used 0.5)");
  r = await bookDesk("C-01", d2, "morning");
  ok(r.row?.billing === "overage" && Number(r.row?.amount) === 300, "limited: past allowance → overage ₹300");
  await db.exec(`update public.plans set desk_days_included = 12 where id = 'limited'`);

  console.log("\nRooms: plan rules, hours, overlaps");
  await as(guest);
  r = await bookRoom("MR4-1", d1, 10, 1);
  ok(r.error?.includes("MEMBERS_ONLY"), "guests / day passes can't book rooms");
  await as(flexi);
  r = await bookRoom("MR4-1", d1, 10, 2);
  ok(r.row?.billing === "included" && Number(r.row?.units) === 2, "flexi books MR4 10–12 with plan hours");
  r = await bookRoom("MR6-1", d1, 13, 4);
  ok(r.row?.billing === "overage" && Number(r.row?.amount) === 750, "flexi: 3 h included + 1 h overage ₹750");
  r = await bookRoom("MR6-2", d1, 17, 2);
  ok(r.error?.includes("OUTSIDE_HOURS"), "after-hours restriction (17–19) for flexi");
  r = await bookRoom("POD-1", d1, 10, 1);
  ok(r.error?.includes("MIN_HOURS_2"), "podcast room needs at least 2 hours");
  r = await bookRoom("POD-1", d2, 10, 2);
  ok(r.row?.billing === "overage" && Number(r.row?.amount) === 5000, "podcast room charged ₹2,500/h");
  await as(limited);
  r = await bookRoom("MR4-1", d1, 11, 1);
  ok(r.error?.includes("TAKEN"), "overlapping room booking refused");
  r = await bookRoom("MR4-1", d1, 12, 1);
  ok(r.row?.status === "confirmed", "back-to-back room booking allowed");
  await as(fixed);
  r = await bookRoom("MR6-2", d1, 18, 2);
  ok(r.row?.status === "confirmed", "fixed plan has after-hours room access");

  console.log("\nMany people, one seat");
  let wins = 0;
  for (let i = 0; i < 60; i++) {
    const u = await user(`rush${i}@spark.test`);
    await as(u);
    const res = await bookDesk("B-10", d2, i % 3 === 0 ? "full" : i % 3 === 1 ? "morning" : "afternoon");
    if (res.row) wins++;
  }
  ok(wins >= 1 && wins <= 2, `60 people tried seat B-10 → ${wins} booking(s), never overlapping`);
  const overlaps = await db.query<{ n: number }>(`
    select count(*)::int n from public.bookings a join public.bookings b
      on a.resource_id = b.resource_id and a.id < b.id and a.slot && b.slot
     where a.status in ('held','confirmed') and b.status in ('held','confirmed')`);
  ok(overlaps.rows[0].n === 0, "no overlapping live bookings anywhere");

  console.log("\nOccupancy mirror, cancel, check-in");
  const occ = await db.query<{ a: number; b: number }>(`
    select (select count(*)::int from public.occupancy) a,
           (select count(*)::int from public.bookings where status in ('held','confirmed')) b`);
  ok(occ.rows[0].a === occ.rows[0].b, "public occupancy mirrors live bookings");
  await as(flexi);
  const mine = (await db.query<{ id: string }>(
    `select id from public.bookings where user_id = $1 and resource_id = 'A-01'`, [flexi])).rows[0].id;
  await as(guest);
  r = await rpc(`select * from public.cancel_booking($1)`, [mine]);
  ok(r.error?.includes("NOT_ALLOWED"), "you can't cancel someone else's booking");
  await as(flexi);
  r = await rpc(`select * from public.check_in($1)`, [mine]);
  ok(r.error?.includes("NOT_TODAY"), "check-in only on the day of the booking");
  r = await rpc(`select * from public.cancel_booking($1)`, [mine]);
  ok(r.row?.status === "cancelled", "member cancels their own booking");
  await as(guest);
  r = await bookDesk("A-01", d1, "morning");
  ok(r.row?.status === "held", "cancelled seat is free again");

  console.log("\nAdmin");
  await as(admin);
  r = await rpc(`select * from public.admin_block('A-03', $1::date, 'maintenance')`, [d1]);
  ok(r.row?.kind === "block", "staff block a seat for the day");
  await as(flexi);
  r = await bookDesk("A-03", d1, "afternoon");
  ok(r.error?.includes("TAKEN"), "blocked seat can't be booked");
  await as(admin);
  r = await rpc(`select * from public.admin_block('A-02', $1::date, 'x')`, [d1]);
  ok(r.error?.includes("HAS_BOOKINGS"), "can't block over existing bookings");

  console.log("\nCalendar feed tokens");
  await as(flexi);
  const tok = async (reset: boolean) =>
    (await db.query<{ t: string }>(`select public.my_calendar_token($1) t`, [reset])).rows[0].t;
  const t1 = await tok(false);
  const t2 = await tok(false);
  const t3 = await tok(true);
  ok(t1.length === 64 && t1 === t2, "each person gets one stable 64-char feed token");
  ok(t3 !== t1, "resetting the feed link issues a new token");

  console.log("\nRow level security (as a signed-in user)");
  await as(flexi);
  await db.exec(`set role authenticated`);
  const visible = await db.query<{ n: number; others: number }>(
    `select count(*)::int n, count(*) filter (where user_id <> auth.uid())::int others from public.bookings`);
  ok(visible.rows[0].n > 0 && visible.rows[0].others === 0, "members only see their own bookings");
  const occVisible = await db.query<{ n: number }>(`select count(*)::int n from public.occupancy`);
  ok(occVisible.rows[0].n > 1, "everyone sees the anonymous seat map");
  let roleErr = "";
  try {
    await db.query(`update public.profiles set role = 'admin' where id = auth.uid()`);
  } catch (e) {
    roleErr = (e as Error).message;
  }
  ok(/role can only be changed|permission denied/.test(roleErr), "members can't make themselves admin");
  const ownName = await db.query(`update public.profiles set full_name = 'Flexi Person' where id = auth.uid() returning full_name`);
  ok(ownName.rows.length === 1, "members can edit their own name");
  let payErr = "";
  try {
    await db.query(`select public.confirm_paid_booking($1, 'demo', 'x', 'y')`, [guestHold]);
  } catch (e) {
    payErr = (e as Error).message;
  }
  ok(payErr.includes("permission denied"), "only the server can mark a booking paid");
  let tokErr = "";
  try {
    await db.query(`select token from public.calendar_tokens`);
  } catch (e) {
    tokErr = (e as Error).message;
  }
  ok(tokErr.includes("permission denied"), "nobody can list other people's calendar tokens");
  await db.exec(`reset role`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
