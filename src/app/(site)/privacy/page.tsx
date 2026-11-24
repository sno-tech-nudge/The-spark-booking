import type { Metadata } from "next";
import { PageHeader } from "@/components/brand";

export const metadata: Metadata = { title: "Privacy · the*spark centre" };

const UPDATED = "24 November 2026";

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader kicker="your data, plainly" title="Privacy policy" sub={`the*spark Pullur Centre booking app · updated ${UPDATED}`} />
      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-ink/80">
        <p>
          This app lets members and visitors book seats, rooms and events at the*spark Pullur Centre, ITPL Main Rd,
          Whitefield, Bengaluru. This page explains what we collect, why, and the choices you have.
        </p>

        <Section title="What we collect">
          <li><b>Account details:</b> your email address. If you sign in with Google, your name and profile photo from your Google account (we never see your Google password).</li>
          <li><b>Details you add:</b> name, phone number and organisation — used for bookings and to contact you about them.</li>
          <li><b>Bookings and tickets:</b> seats, rooms and events you book, check-ins, and membership plan usage.</li>
          <li><b>Payments:</b> amounts and payment references. Card and bank details are handled by our payment provider (Razorpay) and never reach us.</li>
          <li><b>Notifications and calendar:</b> if you switch them on, a push-notification address for your device, and a private calendar-feed link.</li>
        </Section>

        <Section title="How we use it">
          <li>To run your bookings: holding seats, preventing double bookings, check-in, reminders and receipts.</li>
          <li>To bill members for plan usage and overage, and to issue refunds.</li>
          <li>To send the notifications you choose (booking reminders, event updates, centre notices).</li>
          <li>To understand how the space is used (occupancy and event attendance), in aggregate.</li>
        </Section>

        <Section title="Who can see it">
          <li>You, and the*spark staff who run the centre.</li>
          <li>Other people only see anonymous information — e.g. that a seat is taken — never your name, unless you choose to appear in a member directory.</li>
          <li>Our service providers, only to run the app: Supabase (database and sign-in), Vercel (hosting), Google (if you use Google sign-in), Razorpay (payments) and your browser&apos;s push service.</li>
          <li>We don&apos;t sell your data or use it for advertising.</li>
        </Section>

        <Section title="Your choices">
          <li>Edit your details any time in My bookings.</li>
          <li>Switch notifications or calendar sync off, or reset your calendar link, from My bookings.</li>
          <li>Ask us to export or delete your account and data by emailing <a className="underline" href="mailto:hello@thesparkcentre.in">hello@thesparkcentre.in</a>. We keep payment records as long as tax law requires.</li>
        </Section>

        <Section title="Keeping it safe">
          <li>Data is stored with Supabase with row-level security: each person can read only their own bookings and tickets.</li>
          <li>Connections are encrypted (HTTPS). Staff access is limited to the admin team.</li>
        </Section>

        <p className="text-sm text-ink/55">
          Questions? Write to <a className="underline" href="mailto:hello@thesparkcentre.in">hello@thesparkcentre.in</a>. We&apos;ll update this page if anything changes.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink/55">{title}</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">{children}</ul>
    </section>
  );
}
