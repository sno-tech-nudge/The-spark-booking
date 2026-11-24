import { SparkMark } from "./brand";
import { CATEGORY_LOOK, evDateParts, type SparkEvent } from "@/lib/events";

/**
 * Event poster. Uses the uploaded image when there is one; otherwise draws a
 * branded poster (category colours, big asterisk, title) so every card looks
 * intentional — District-style, without needing a designer for each event.
 */
export function EventCover({
  event, className = "", showTitle = true, rounded = "rounded-2xl",
}: {
  event: Pick<SparkEvent, "title" | "category" | "image_url" | "starts_at" | "host_name">;
  className?: string;
  showTitle?: boolean;
  rounded?: string;
}) {
  if (event.image_url) {
    return (
      <div className={`relative overflow-hidden bg-ink ${rounded} ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={event.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }
  const look = CATEGORY_LOOK[event.category] ?? CATEGORY_LOOK.Community;
  const d = evDateParts(event.starts_at);
  return (
    <div
      className={`relative overflow-hidden ${rounded} ${className}`}
      style={{ background: `linear-gradient(140deg, ${look.from} 0%, ${look.to} 100%)`, color: look.ink }}
      aria-hidden
    >
      <span className="absolute -right-[16%] -top-[12%] aspect-square h-[78%]" style={{ color: look.spark }}>
        <SparkMark className="h-full w-full" />
      </span>
      {/* showTitle={false} = artwork only (the card around it shows the text) */}
      {showTitle && (
        <div className="absolute inset-0 flex flex-col justify-between p-[7%]">
          <span className="self-end rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] opacity-80">
            {event.category}
          </span>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] opacity-70">{d.w} · {d.d} {d.m}</p>
            <p className="mt-1 line-clamp-3 text-[clamp(18px,2.6vw,28px)] font-light uppercase leading-[1.05]">{event.title}</p>
            <p className="mt-2 text-[11px] opacity-70">the<span style={{ color: look.spark }}>*</span>spark · {event.host_name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
