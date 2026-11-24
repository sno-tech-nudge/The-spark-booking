// Events: types, formatting and the look of generated posters.

export const EVENT_CATEGORIES = ["Networking", "Workshop", "Talk", "Community", "Showcase", "Wellness"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export type SparkEvent = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string;
  category: EventCategory;
  host_name: string;
  host_org: string | null;
  image_url: string | null;
  venue: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  member_price: number;
  guest_price: number;
  rsvp_closes_at: string | null;
  status: "draft" | "published" | "cancelled";
  going_count: number;
  waitlist_count: number;
  created_at: string;
};

export type Rsvp = {
  id: string;
  event_id: string;
  user_id: string;
  status: "going" | "held" | "waitlist" | "cancelled" | "expired";
  ticket_type: "member" | "guest";
  amount: number;
  billing: "free" | "pending_payment" | "paid" | "refund_due";
  hold_expires_at: string | null;
  promoted_at: string | null;
  checked_in_at: string | null;
  created_at: string;
};

const TZ = "Asia/Kolkata";

/** "Sat, 29 Nov" */
export const evDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
/** "6:00 PM" */
export const evTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).toUpperCase();
/** { d: "29", m: "NOV", w: "SAT" } for date blocks */
export const evDateParts = (iso: string) => {
  const d = new Date(iso);
  return {
    d: d.toLocaleDateString("en-IN", { day: "numeric", timeZone: TZ }),
    m: d.toLocaleDateString("en-IN", { month: "short", timeZone: TZ }).toUpperCase(),
    w: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: TZ }).toUpperCase(),
  };
};
export const evRange = (e: Pick<SparkEvent, "starts_at" | "ends_at">) => `${evDay(e.starts_at)} · ${evTime(e.starts_at)} – ${evTime(e.ends_at)}`;

export const spotsLeft = (e: SparkEvent) => Math.max(0, e.capacity - e.going_count);
export const isSoldOut = (e: SparkEvent) => spotsLeft(e) === 0;
export const fillRatio = (e: SparkEvent) => Math.min(1, e.going_count / Math.max(e.capacity, 1));

/** "Free", "₹499", or "₹0 members · ₹500 guests" */
export function priceLabel(e: Pick<SparkEvent, "member_price" | "guest_price">, short = false) {
  const { member_price: m, guest_price: g } = e;
  if (m === 0 && g === 0) return "Free";
  if (m === g) return `₹${m.toLocaleString("en-IN")}`;
  if (short) return m === 0 ? "Free for members" : `₹${Math.min(m, g).toLocaleString("en-IN")} onwards`;
  return `${m === 0 ? "Free" : `₹${m.toLocaleString("en-IN")}`} members · ₹${g.toLocaleString("en-IN")} guests`;
}

/** Urgency chip text, District-style. */
export function urgency(e: SparkEvent): { text: string; tone: "hot" | "warm" | "out" } | null {
  const left = spotsLeft(e);
  if (left === 0) return { text: e.waitlist_count ? `Sold out · ${e.waitlist_count} waiting` : "Sold out · join waitlist", tone: "out" };
  if (left <= 5) return { text: `Only ${left} left`, tone: "hot" };
  if (fillRatio(e) >= 0.6) return { text: "Filling fast", tone: "warm" };
  return null;
}

/** Generated poster palettes per category (used when there's no uploaded image). */
export const CATEGORY_LOOK: Record<EventCategory, { from: string; to: string; ink: string; spark: string }> = {
  Networking: { from: "#ffa927", to: "#f4932e", ink: "#101010", spark: "#ffffff" },
  Workshop: { from: "#101010", to: "#424548", ink: "#f9f1e8", spark: "#ffa927" },
  Talk: { from: "#f9f1e8", to: "#e2d0b5", ink: "#101010", spark: "#ffa927" },
  Community: { from: "#ffe599", to: "#ffa927", ink: "#101010", spark: "#ffffff" },
  Showcase: { from: "#424548", to: "#101010", ink: "#ffe599", spark: "#ffa927" },
  Wellness: { from: "#fff2cc", to: "#f5b35d", ink: "#101010", spark: "#ffffff" },
};

export function slugify(title: string) {
  const base = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return `${base || "event"}-${Math.random().toString(36).slice(2, 6)}`;
}
