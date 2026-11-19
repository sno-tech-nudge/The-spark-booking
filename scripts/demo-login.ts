/**
 * Demo personas for showing the prototype without sending any email.
 *
 *   npm run demo:login                 → creates the personas (once) and prints a sign-in link for each
 *   npm run demo:login -- member       → link for one persona
 *   npm run demo:login -- guest https://your-app.vercel.app
 *   npm run demo:login -- you@example.org https://your-app.vercel.app   → link for a real account
 *
 * Personas (fake @spark.test addresses, never emailed):
 *   staff    → admin panel
 *   member   → Flexi Desk member
 *   limited  → Limited Plan member (12 days/month)
 *   fixed    → Fixed Desk member with seat D-31
 *   guest    → day-pass visitor (pays per booking)
 *
 * Each link works once and expires in about an hour. Uses SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const PERSONAS = {
  staff: { email: "staff@spark.test", name: "Spark Staff", plan: null, seat: null, admin: true },
  member: { email: "member@spark.test", name: "Flexi Member", plan: "flexi", seat: null, admin: false },
  limited: { email: "limited@spark.test", name: "Limited Member", plan: "limited", seat: null, admin: false },
  fixed: { email: "fixed@spark.test", name: "Fixed Desk Member", plan: "fixed", seat: "D-31", admin: false },
  guest: { email: "guest@spark.test", name: "Day Pass Guest", plan: null, seat: null, admin: false },
} as const;

async function main() {
  const which = process.argv[2] as keyof typeof PERSONAS | undefined;
  const base = (process.argv[3] ?? "http://localhost:3000").replace(/\/$/, "");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Any real email (already set up as admin/member in the app): instant sign-in link, no email sent.
  //   npm run demo:login -- you@example.org https://sparkbooking.vercel.app
  if (which && String(which).includes("@")) {
    const email = String(which).toLowerCase();
    let { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email });
    if (error && /not found/i.test(error.message)) {
      await sb.auth.admin.createUser({ email, email_confirm: true });
      ({ data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email }));
    }
    if (error || !data?.properties) throw error ?? new Error("Could not create a link");
    const { data: prof } = await sb.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
    const next = prof?.role === "admin" ? "/admin" : "/book";
    console.log(`${email} (${prof?.role ?? "new"})\n${base}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${next}`);
    return;
  }

  const keys = which ? [which] : (Object.keys(PERSONAS) as (keyof typeof PERSONAS)[]);
  for (const key of keys) {
    const p = PERSONAS[key];
    if (!p) throw new Error(`Unknown persona "${key}". Use one of: ${Object.keys(PERSONAS).join(", ")}`);

    if (p.admin) await sb.from("admin_emails").upsert({ email: p.email });
    if (p.plan) {
      const { data: existing } = await sb.from("memberships").select("id").eq("email", p.email).eq("status", "active").maybeSingle();
      if (!existing) {
        const { error } = await sb.from("memberships").insert({
          email: p.email, plan_id: p.plan, organisation: "Demo Org", assigned_seat_id: p.seat,
        });
        if (error) throw error;
      }
    }

    const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: p.email });
    let link = data;
    if (error && /not found|User not found/i.test(error.message)) {
      await sb.auth.admin.createUser({ email: p.email, email_confirm: true });
      ({ data: link } = await sb.auth.admin.generateLink({ type: "magiclink", email: p.email }));
    } else if (error) {
      throw error;
    }
    if (!link?.user || !link.properties) throw new Error(`Could not create a sign-in link for ${p.email}`);
    const uid = link.user.id;
    await sb.from("profiles").update({ full_name: p.name }).eq("id", uid).is("full_name", null);

    const next = p.admin ? "/admin" : "/book";
    console.log(`${key.padEnd(8)} ${base}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=${next}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
