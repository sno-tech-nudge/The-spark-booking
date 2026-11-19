import Link from "next/link";
import { CornerSpark, Eyebrow, SparkMark, Wordmark } from "@/components/brand";

const PLANS = [
  { name: "Flexi Desk", price: "12,000", per: "/ member / month", points: ["Any free seat, full-time", "5 meeting-room hours a month", "Book seats & rooms in the app"], tone: "spark" },
  { name: "Limited Plan", price: "9,000", per: "/ member / month", points: ["12 desk days a month", "2 meeting-room hours a month", "Extra days billed as overage"], tone: "light" },
  { name: "Day Pass", price: "500", per: "/ day", points: ["Pick your seat live, pay online", "Half day ₹300", "No meeting-room access"], tone: "light" },
  { name: "Fixed Desk", price: "15,000", per: "/ member / month", points: ["Your own assigned seat", "For contract members", "After-hours room access"], tone: "ink" },
] as const;

const ROOMS = [
  ["Meeting room", "4 pax", "₹500 / hour"],
  ["Meeting room ×2", "6 pax", "₹750 / hour"],
  ["Meeting room", "8–10 pax", "₹1,000 / hour"],
  ["Podcast room", "4 pax", "₹2,500 / hour · min 2 h"],
  ["Phone booths ×3", "1 pax", "Free for members"],
  ["Lounge workstations ×2", "1 pax", "Free for members"],
];

const STEPS = [
  ["01", "Pick a day & slot", "Morning, afternoon or the full day — up to two weeks ahead."],
  ["02", "Tap a free seat", "The floor map is live: seats change the instant someone books."],
  ["03", "Confirm", "Members book on their plan. Guests get the seat held while they pay."],
];

export default function Home() {
  return (
    <div>
      {/* Hero — the animated logo, as in the Pullur logo film */}
      <section className="relative overflow-hidden">
        <CornerSpark className="!right-6 !top-6 !h-7 !w-7" />
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-16 pt-16 text-center sm:pb-24 sm:pt-24">
          <p className="rise font-serif text-base italic text-spark-dark">purpose-built for social innovation</p>
          <h1 className="mt-8 text-[clamp(56px,11vw,128px)]">
            <Wordmark sub animated />
          </h1>
          <p className="rise mt-10 max-w-xl text-lg font-light text-ink/75 [animation-delay:1.6s]">
            Grab a seat in seconds. Watch all 127 open-plan seats update live — and never worry about a double booking.
          </p>
          <div className="rise mt-8 flex flex-wrap justify-center gap-3 [animation-delay:1.8s]">
            <Link href="/book" className="btn-spark px-7 text-base">Book a seat</Link>
            <Link href="/rooms" className="btn-ghost px-6 text-base">Meeting rooms</Link>
          </div>
          <dl className="rise mt-16 grid w-full max-w-3xl grid-cols-3 divide-x divide-sand border-y border-sand py-6 [animation-delay:2s]">
            {[["127", "open-plan seats"], ["10", "rooms & booths"], ["Mon–Sat", "9am – 6pm"]].map(([v, l]) => (
              <div key={l} className="px-2">
                <dd className="whitespace-nowrap text-2xl font-light sm:text-4xl">{v}</dd>
                <dt className="mt-1 text-[11px] uppercase tracking-[0.14em] text-ink/55">{l}</dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Process — deck "process slide" chevrons */}
      <section className="relative mx-auto max-w-6xl px-4 py-16">
        <Eyebrow>How booking works</Eyebrow>
        <h2 className="mt-2 text-3xl font-light uppercase">Three taps to a desk</h2>
        <div className="mt-8 grid gap-3 md:grid-cols-3 md:gap-0">
          {STEPS.map(([n, t, d], i) => (
            <div key={n}>
              <div
                className={`flex h-14 items-center px-6 font-medium md:[clip-path:polygon(0_0,calc(100%-18px)_0,100%_50%,calc(100%-18px)_100%,0_100%,18px_50%)] ${
                  ["bg-spark", "bg-spark-soft", "bg-spark-light"][i]
                } ${i === 0 ? "md:[clip-path:polygon(0_0,calc(100%-18px)_0,100%_50%,calc(100%-18px)_100%,0_100%)]" : ""} rounded-xl md:rounded-none`}
              >
                <span className="mr-3 text-sm opacity-70">{n}</span>
                {t}
              </div>
              <p className="px-6 pt-4 text-sm leading-relaxed text-ink/65">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans — box list cards */}
      <section className="border-y border-sand/70 bg-cream/50">
        <div className="relative mx-auto max-w-6xl px-4 py-16">
          <CornerSpark />
          <Eyebrow>Membership plans</Eyebrow>
          <h2 className="mt-2 text-3xl font-light uppercase">Flexibility, by design</h2>
          <p className="mt-2 font-serif text-sm italic text-ink/60">All prices excl. GST</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`flex flex-col rounded-2xl border p-6 ${
                  p.tone === "ink" ? "border-ink bg-ink text-paper"
                  : p.tone === "spark" ? "border-spark bg-white"
                  : "border-sand bg-white/80"
                }`}
              >
                <div className="flex items-start justify-between">
                  <p className={`font-medium ${p.tone === "ink" ? "text-spark" : "text-spark-dark"}`}>{p.name}</p>
                  {p.tone === "spark" && <span className="chip bg-spark text-ink">Most popular</span>}
                </div>
                <p className="mt-5">
                  <span className="text-sm align-top">₹</span>
                  <span className="text-4xl font-light">{p.price}</span>
                </p>
                <p className={`text-xs ${p.tone === "ink" ? "text-paper/55" : "text-ink/50"}`}>{p.per}</p>
                <ul className={`mt-5 space-y-2 border-t pt-4 text-sm ${p.tone === "ink" ? "border-paper/15 text-paper/80" : "border-sand text-ink/70"}`}>
                  {p.points.map((x) => (
                    <li key={x} className="flex gap-2">
                      <SparkMark className="mt-1 h-3 w-3 shrink-0 text-spark" />
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Rooms — deck table style */}
      <section className="relative mx-auto max-w-6xl px-4 py-16">
        <Eyebrow>Rooms & booths</Eyebrow>
        <h2 className="mt-2 text-3xl font-light uppercase">Designed for gathering</h2>
        <div className="mt-8 overflow-hidden rounded-2xl border border-sand bg-white/80">
          <table className="brand-table w-full text-sm">
            <thead>
              <tr>
                <th className="px-5 py-3 text-left">Space</th>
                <th className="px-5 py-3 text-left">Capacity</th>
                <th className="px-5 py-3 text-left">Rate</th>
              </tr>
            </thead>
            <tbody>
              {ROOMS.map(([n, c, r]) => (
                <tr key={`${n}-${c}`}>
                  <td className="px-5 py-3">{n}</td>
                  <td className="px-5 py-3 text-ink/60">{c}</td>
                  <td className="px-5 py-3">{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/rooms" className="btn-ink mt-6">See room availability</Link>
      </section>

      {/* Closing band — the orange logo slide */}
      <section className="relative overflow-hidden bg-spark">
        <SparkMark className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 text-white/25" />
        <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14">
          <div>
            <p className="font-serif italic text-ink/70">where founders, funders and the ecosystem meet</p>
            <h2 className="mt-2 text-3xl font-light uppercase sm:text-4xl">Your seat is waiting</h2>
          </div>
          <Link href="/book" className="btn-ink px-7 text-base">Find your seat</Link>
        </div>
      </section>
    </div>
  );
}
