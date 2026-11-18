import Link from "next/link";

const PLANS = [
  { name: "Flexi Desk", price: "₹12,000", per: "/member/month", points: ["Any free seat, full-time", "5 meeting-room hours / month", "Book seats & rooms in the app"] },
  { name: "Limited Plan", price: "₹9,000", per: "/member/month", points: ["12 desk days a month", "2 meeting-room hours / month", "Extra days billed as overage"] },
  { name: "Day Pass", price: "₹500", per: "/day", points: ["Pick your seat live, pay online", "Half day available", "No meeting-room access"] },
  { name: "Fixed Desk", price: "₹15,000", per: "/member/month", points: ["Your own assigned seat", "Contract members only", "After-hours room access"] },
];

const ROOMS = [
  { name: "Meeting room · 4 pax", price: "₹500/h" },
  { name: "Meeting room · 6 pax ×2", price: "₹750/h" },
  { name: "Meeting room · 8–10 pax", price: "₹1,000/h" },
  { name: "Podcast room", price: "₹2,500/h · min 2h" },
  { name: "Phone booths ×3", price: "Free for members" },
  { name: "Lounge workstations ×2", price: "Free for members" },
];

export default function Home() {
  return (
    <div>
      <section className="bg-ink text-paper">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
          <p className="font-serif text-sm italic text-spark">purpose-built for social innovation</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-light leading-tight sm:text-6xl">
            Grab a seat at the<span className="text-spark">*</span>spark — live, in seconds.
          </h1>
          <p className="mt-5 max-w-xl text-paper/70">
            See every one of our 127 open-plan seats update in real time. Pick yours, confirm, done.
            No double bookings, ever.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/book" className="btn-spark text-base">Book a seat →</Link>
            <Link href="/rooms" className="inline-flex items-center rounded-full border border-paper/30 px-5 py-2.5 text-paper hover:bg-paper/10">Meeting rooms</Link>
          </div>
          <dl className="mt-14 grid max-w-2xl grid-cols-3 gap-6 text-sm">
            <div><dt className="text-paper/50">Open-plan seats</dt><dd className="text-3xl font-semibold">127</dd></div>
            <div><dt className="text-paper/50">Rooms & booths</dt><dd className="text-3xl font-semibold">10</dd></div>
            <div><dt className="text-paper/50">Open</dt><dd className="text-3xl font-semibold">Mon–Sat</dd></div>
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold">How booking works</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ["1", "Pick a day and slot", "Morning, afternoon or the full day — up to two weeks ahead."],
            ["2", "Tap a free seat", "The floor map is live: seats turn grey the instant someone books them."],
            ["3", "Confirm", "Members book under their plan. Day-pass guests get the seat held for 8 minutes while they pay."],
          ].map(([n, t, d]) => (
            <div key={n} className="card p-6">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-spark font-semibold">{n}</span>
              <p className="mt-4 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-ink/60">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-cream/60">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold">Plans</h2>
          <p className="mt-1 text-sm text-ink/60">All prices excl. GST.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.name} className="card flex flex-col p-6">
                <p className="font-semibold">{p.name}</p>
                <p className="mt-3"><span className="text-3xl font-semibold">{p.price}</span><span className="text-xs text-ink/50">{p.per}</span></p>
                <ul className="mt-4 space-y-1.5 text-sm text-ink/70">
                  {p.points.map((x) => <li key={x}>· {x}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold">Rooms & booths</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ROOMS.map((r) => (
            <div key={r.name} className="card flex items-center justify-between p-5">
              <span className="font-medium">{r.name}</span>
              <span className="text-sm text-ink/60">{r.price}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
