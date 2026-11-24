import { NextResponse } from "next/server";
import { allSubscribedUsers, sendPushes } from "@/lib/push";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { closureScope, type Announcement } from "@/lib/announcements";
import { fmtDate } from "@/lib/time";

// Staff just posted a notice: tell everyone with notifications on, right away.
export async function POST(req: Request) {
  const { announcementId } = await req.json().catch(() => ({}));
  if (typeof announcementId !== "string") return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: me } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const svc = supabaseService();
  const { data } = await svc.from("announcements").select("*").eq("id", announcementId).maybeSingle();
  const a = data as Announcement | null;
  if (!a || !a.active) return NextResponse.json({ error: "Notice not found" }, { status: 404 });

  let room: string | undefined;
  if (a.resource_id) room = (await svc.from("resources").select("name").eq("id", a.resource_id).maybeSingle()).data?.name;
  const when = a.starts_on === a.ends_on ? fmtDate(a.starts_on) : `${fmtDate(a.starts_on)} – ${fmtDate(a.ends_on)}`;
  const title = a.closure === "none" ? "Notice from the*spark" : `Notice: ${closureScope(a, room)} · ${when}`;
  const users = await allSubscribedUsers();
  const result = await sendPushes(users.map((u) => ({
    key: `notice:${a.id}:${u}`, userId: u, title, body: a.message, url: a.closure === "none" ? "/now" : "/book",
  })));
  return NextResponse.json(result);
}
