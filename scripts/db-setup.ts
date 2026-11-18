/**
 * One-time setup of a Supabase project: creates the schema, loads seats/rooms/
 * plans, and marks staff emails as admins.
 *
 *   1. Put DATABASE_URL (Supabase → Connect → Session pooler) and ADMIN_EMAILS in .env.local
 *   2. npm run db:setup
 *
 * Safe to re-run: the schema is only created once; seed + admins are upserts.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

config({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing in .env.local");
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();

  const root = join(__dirname, "..");
  const { rows } = await db.query(`select to_regclass('public.bookings') as t`);
  if (!rows[0].t) {
    console.log("Creating schema…");
    await db.query(readFileSync(join(root, "supabase/migrations/0001_init.sql"), "utf8"));
  } else {
    console.log("Schema already exists — skipping migration.");
  }

  console.log("Loading seats, rooms, plans…");
  await db.query(readFileSync(join(root, "supabase/seed.sql"), "utf8"));

  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const email of admins) {
    await db.query(`insert into public.admin_emails (email) values ($1) on conflict do nothing`, [email]);
  }
  console.log(admins.length ? `Staff emails set: ${admins.length}` : "No ADMIN_EMAILS set — add some to use /admin.");

  const c = await db.query(`select count(*) filter (where kind='desk') desks, count(*) filter (where kind='room') rooms from public.resources`);
  console.log(`Done. ${c.rows[0].desks} desks, ${c.rows[0].rooms} rooms.`);
  await db.end();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
