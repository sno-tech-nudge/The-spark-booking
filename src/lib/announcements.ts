import type { Resource } from "./types";

export type Closure = "none" | "centre" | "desks" | "rooms" | "zone" | "resource";

export type Announcement = {
  id: string;
  message: string;
  starts_on: string;
  ends_on: string;
  closure: Closure;
  zone: string | null;
  resource_id: string | null;
  active: boolean;
  created_at: string;
};

export const CLOSURE_LABELS: Record<Closure, string> = {
  none: "Just a notice (nothing closes)",
  centre: "Close the whole centre",
  desks: "Close all desks",
  rooms: "Close all rooms & booths",
  zone: "Close one zone of desks",
  resource: "Close one seat or room",
};

export function appliesTo(a: Announcement, r: Pick<Resource, "id" | "kind" | "zone">): boolean {
  switch (a.closure) {
    case "centre": return true;
    case "desks": return r.kind === "desk";
    case "rooms": return r.kind === "room";
    case "zone": return r.kind === "desk" && r.zone === a.zone;
    case "resource": return r.id === a.resource_id;
    default: return false;
  }
}

/** resource id → closure message, for one date. Mirrors public.closure_message(). */
export function closedOn(anns: Announcement[], date: string | null, resources: Resource[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!date) return out;
  const live = anns
    .filter((a) => a.active && a.closure !== "none" && a.starts_on <= date && date <= a.ends_on)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of resources) {
    const hit = live.find((a) => appliesTo(a, r));
    if (hit) out.set(r.id, hit.message);
  }
  return out;
}

/** What a closure covers, in words ("Zone B", "all rooms"…). */
export function closureScope(a: Announcement, resourceName?: string): string {
  switch (a.closure) {
    case "centre": return "Centre closed";
    case "desks": return "All desks closed";
    case "rooms": return "All rooms closed";
    case "zone": return `Zone ${a.zone} closed`;
    case "resource": return `${resourceName ?? a.resource_id} closed`;
    default: return "";
  }
}
