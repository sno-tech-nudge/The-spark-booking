"use client";

import type { Occupancy, Part, Resource } from "@/lib/types";
import { partsOverlap } from "@/lib/time";

export type SeatState = "free" | "held" | "booked" | "blocked" | "assigned" | "mine" | "my-seat";

export const SEAT_STYLES: Record<SeatState, { cls: string; label: string }> = {
  free: { cls: "bg-white border-free/60 text-ink hover:bg-free hover:text-white hover:border-free", label: "Available" },
  held: { cls: "bg-held/70 border-held text-ink/70 cursor-not-allowed", label: "Being booked" },
  booked: { cls: "bg-ink/15 border-transparent text-ink/40 cursor-not-allowed", label: "Booked" },
  blocked: { cls: "hatch bg-ink/5 border-ink/10 text-ink/30 cursor-not-allowed", label: "Unavailable" },
  assigned: { cls: "bg-ink border-ink text-paper/70 cursor-not-allowed", label: "Fixed desk" },
  mine: { cls: "bg-spark border-spark-dark text-ink", label: "Yours" },
  "my-seat": { cls: "bg-spark/40 border-spark-dark text-ink hover:bg-spark", label: "Your fixed desk" },
};

export function seatStates(
  desks: Resource[],
  occupancy: Occupancy[],
  part: Part,
  myBookingIds: Set<string>,
  myAssignedSeat: string | null,
): Map<string, SeatState> {
  const out = new Map<string, SeatState>();
  for (const d of desks) {
    out.set(d.id, d.assigned_membership ? (d.id === myAssignedSeat ? "my-seat" : "assigned") : "free");
  }
  for (const o of occupancy) {
    if (!out.has(o.resource_id)) continue;
    const overlaps = o.kind === "block" || (o.part ? partsOverlap(o.part, part) : true);
    if (!overlaps) continue;
    const current = out.get(o.resource_id)!;
    let next: SeatState;
    if (myBookingIds.has(o.booking_id)) next = "mine";
    else if (o.kind === "block") next = "blocked";
    else if (o.status === "held") next = "held";
    else next = "booked";
    // precedence: mine > booked/blocked > held > anything else
    const rank: Record<SeatState, number> = { mine: 5, blocked: 4, booked: 3, held: 2, assigned: 1, "my-seat": 1, free: 0 };
    if (rank[next] >= rank[current]) out.set(o.resource_id, next);
  }
  return out;
}

export function SeatLegend({ compact = false }: { compact?: boolean }) {
  const shown: SeatState[] = compact ? ["free", "held", "booked", "mine"] : ["free", "held", "booked", "mine", "assigned", "blocked"];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink/70">
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={`h-3.5 w-3.5 rounded-[4px] border ${SEAT_STYLES[s].cls}`} />
          {SEAT_STYLES[s].label}
        </span>
      ))}
    </div>
  );
}

type Props = {
  desks: Resource[];
  states: Map<string, SeatState>;
  selected: string | null;
  flash?: Set<string>;
  onSelect: (id: string) => void;
  labelFor?: (id: string) => string | undefined;
};

/** Open-plan floor: four zones of 8-seat tables (seats face each other across the table). */
export function SeatMap({ desks, states, selected, flash, onSelect, labelFor }: Props) {
  const zones = new Map<string, Map<number, Resource[]>>();
  for (const d of desks) {
    const z = d.zone ?? "?";
    if (!zones.has(z)) zones.set(z, new Map());
    const tables = zones.get(z)!;
    const t = d.table_no ?? 1;
    if (!tables.has(t)) tables.set(t, []);
    tables.get(t)!.push(d);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[...zones.entries()].map(([zone, tables]) => {
        const all = [...tables.values()].flat();
        const free = all.filter((d) => {
          const s = states.get(d.id);
          return s === "free" || s === "my-seat";
        }).length;
        return (
          <section key={zone} className="card p-4 sm:p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="font-semibold">Zone {zone}</h3>
              <span className="text-xs text-ink/50">
                {free} of {all.length} free
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              {[...tables.entries()].map(([t, seats]) => {
                const top = seats.slice(0, Math.ceil(seats.length / 2));
                const bottom = seats.slice(Math.ceil(seats.length / 2));
                return (
                  <div key={t} className="flex flex-col items-stretch gap-1">
                    <SeatRow seats={top} states={states} selected={selected} flash={flash} onSelect={onSelect} labelFor={labelFor} />
                    <div className="mx-1 h-3 rounded-md bg-cream" title={`Table ${zone}${t}`} />
                    <SeatRow seats={bottom} states={states} selected={selected} flash={flash} onSelect={onSelect} labelFor={labelFor} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SeatRow({
  seats, states, selected, flash, onSelect, labelFor,
}: Omit<Props, "desks"> & { seats: Resource[] }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {seats.map((d) => {
        const s = states.get(d.id) ?? "free";
        const clickable = s === "free" || s === "my-seat" || (labelFor !== undefined);
        const isSel = selected === d.id;
        const num = d.id.split("-")[1];
        const extra = labelFor?.(d.id);
        return (
          <button
            key={d.id}
            type="button"
            disabled={!clickable}
            onClick={() => onSelect(d.id)}
            title={`${d.id} · ${SEAT_STYLES[s].label}${extra ? ` · ${extra}` : ""}`}
            aria-label={`Seat ${d.id}, ${SEAT_STYLES[s].label}`}
            className={`relative h-9 rounded-lg border text-[11px] font-semibold transition-all duration-200 ${SEAT_STYLES[s].cls} ${
              isSel ? "!border-ink !bg-ink !text-spark ring-2 ring-spark ring-offset-1 scale-105" : ""
            } ${flash?.has(d.id) ? "seat-pop" : ""}`}
          >
            {num}
          </button>
        );
      })}
    </div>
  );
}
