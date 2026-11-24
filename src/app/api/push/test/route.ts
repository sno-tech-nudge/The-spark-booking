import { NextResponse } from "next/server";
import { pushConfigured, sendPushes } from "@/lib/push";
import { supabaseServer } from "@/lib/supabase/server";

// "Send me a test" from My bookings: one notification to the signed-in person's devices.
export async function POST() {
  if (!pushConfigured) return NextResponse.json({ error: "Notifications aren't set up on the server yet" }, { status: 503 });
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const result = await sendPushes([{
    key: `test:${auth.user.id}:${Date.now()}`,
    userId: auth.user.id,
    title: "the*spark notifications are on",
    body: "You'll get a nudge 15 min before your seat or room, event reminders and centre notices.",
    url: "/me",
  }]);
  if (!result.sent) return NextResponse.json({ error: "No device is registered for notifications yet" }, { status: 404 });
  return NextResponse.json(result);
}
