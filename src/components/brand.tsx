// the*spark brand pieces, from the standard deck and the Pullur logo animation:
// 8-spoke orange asterisk, Montserrat Light wordmark, "PULLUR CENTRE" in orange caps.

type MarkProps = { className?: string; title?: string };

/** The square logo: an 8-spoke asterisk with rounded ends. Inherits currentColor. */
export function SparkMark({ className = "", title }: MarkProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g stroke="currentColor" strokeWidth="13" strokeLinecap="round">
        <line x1="50" y1="9" x2="50" y2="91" />
        <line x1="9" y1="50" x2="91" y2="50" />
        <line x1="21" y1="21" x2="79" y2="79" />
        <line x1="79" y1="21" x2="21" y2="79" />
      </g>
    </svg>
  );
}

/** "the*spark" wordmark, optionally with "PULLUR CENTRE" underneath. Size it with font-size. */
export function Wordmark({
  sub = false, animated = false, className = "", tone = "light",
}: { sub?: boolean; animated?: boolean; className?: string; tone?: "light" | "dark" }) {
  return (
    <span className={`inline-flex flex-col items-center leading-none ${animated ? "logo-anim" : ""} ${className}`} aria-label="the spark, Pullur Centre">
      <span className={`logo-word whitespace-nowrap font-light tracking-[-0.01em] ${tone === "dark" ? "text-paper" : "text-ink"}`}>
        <span className="logo-text inline-block">the</span>
        <SparkMark className="logo-spark relative mx-[0.04em] inline-block h-[0.44em] w-[0.44em] text-spark" />
        <span className="logo-text inline-block">spark</span>
      </span>
      {sub && (
        <span className="logo-sub mt-[0.32em] whitespace-nowrap text-[0.42em] font-light uppercase tracking-[0.04em] text-spark">
          Pullur Centre
        </span>
      )}
    </span>
  );
}

/** Deck-style section label: small uppercase "HEADER TEXT". */
export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[11px] font-normal uppercase tracking-[0.14em] text-ink/60 ${className}`}>{children}</p>;
}

/** Page title in the deck's style: Georgia-italic orange kicker, Montserrat Light caps title. */
export function PageHeader({
  kicker, title, sub, right,
}: { kicker?: string; title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="relative flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && <p className="font-serif text-sm italic text-spark-dark">{kicker}</p>}
        <h1 className="mt-1 text-3xl font-light uppercase tracking-[0.02em] sm:text-4xl">{title}</h1>
        {sub && <p className="mt-2 text-sm text-ink/60">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/** The orange asterisk that sits in the top-right corner of every deck slide. */
export function CornerSpark({ className = "" }: { className?: string }) {
  return <SparkMark className={`pointer-events-none absolute right-4 top-4 h-5 w-5 text-spark ${className}`} />;
}

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return <SparkMark className={`spark-spin text-spark ${className}`} title="Loading" />;
}
