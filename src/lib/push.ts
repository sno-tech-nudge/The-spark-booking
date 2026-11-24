import "server-only";
import * as webpush from "web-push";
import { supabaseService } from "./supabase/server";

export const pushConfigured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://sparkbooking.vercel.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  ready = true;
}

export type PushMessage = {
  /** unique per notification — the same key is never sent twice */
  key: string;
  userId: string;
  title: string;
  body: string;
  url?: string;
};

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

/**
 * Sends each message to every phone/browser the person has switched on.
 * Claims the key in notification_log first, so a retry or an overlapping
 * run can't double-send. Dead subscriptions (uninstalled app) are removed.
 */
export async function sendPushes(messages: PushMessage[], opts: { dedupe?: boolean } = {}) {
  if (!messages.length) return { sent: 0, people: 0, skipped: 0 };
  if (!pushConfigured) return { sent: 0, people: 0, skipped: messages.length, error: "push not configured" };
  setup();
  const svc = supabaseService();

  let todo = messages;
  if (opts.dedupe !== false) {
    const { data: claimed } = await svc
      .from("notification_log")
      .upsert(
        messages.map((m) => ({ key: m.key, user_id: m.userId, title: m.title, body: m.body, url: m.url ?? null })),
        { onConflict: "key", ignoreDuplicates: true },
      )
      .select("key");
    const fresh = new Set((claimed ?? []).map((r: { key: string }) => r.key));
    todo = messages.filter((m) => fresh.has(m.key));
  }
  if (!todo.length) return { sent: 0, people: 0, skipped: messages.length };

  const userIds = [...new Set(todo.map((m) => m.userId))];
  const { data } = await svc.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
  const subs = (data as Sub[]) ?? [];

  let sent = 0;
  const reached = new Set<string>();
  await Promise.all(
    todo.flatMap((m) =>
      subs.filter((s) => s.user_id === m.userId).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: m.title, body: m.body, url: m.url ?? "/me", tag: m.key }),
            { TTL: 3600, urgency: "high" },
          );
          sent++;
          reached.add(m.userId);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await svc.from("push_subscriptions").delete().eq("id", s.id);
        }
      }),
    ),
  );
  return { sent, people: reached.size, skipped: messages.length - todo.length };
}

/** Everyone who has notifications switched on. */
export async function allSubscribedUsers(): Promise<string[]> {
  const { data } = await supabaseService().from("push_subscriptions").select("user_id");
  return [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
}
