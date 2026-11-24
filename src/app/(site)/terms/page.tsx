import type { Metadata } from "next";
import { PageHeader } from "@/components/brand";

export const metadata: Metadata = { title: "Terms · the*spark centre" };

export default function Terms() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader kicker="the short version" title="Terms of use" sub="the*spark Pullur Centre booking app · updated 24 November 2026" />
      <ul className="mt-8 list-disc space-y-3 pl-5 text-[15px] leading-relaxed text-ink/80">
        <li><b>Bookings.</b> A seat, room or event spot is yours once it shows as confirmed. Paid bookings are held for a short time while you pay and are released if payment isn&apos;t completed.</li>
        <li><b>Members.</b> Plan allowances (desk days, room hours) reset monthly. Usage beyond your plan is billed as overage on your next invoice. Prices exclude GST.</li>
        <li><b>Day passes and tickets.</b> Paid online. If we can&apos;t honour a paid booking (for example, a closure or a lapsed hold), we refund it in full.</li>
        <li><b>Cancelling.</b> Cancel from My bookings before your slot starts so someone else can use it. Seats not checked in may be released to others.</li>
        <li><b>Closures.</b> We may close the centre, a zone or a room for maintenance or events; we show this in the app and block new bookings for those dates.</li>
        <li><b>Fair use.</b> One desk per person at a time; please don&apos;t book space you won&apos;t use. We may suspend accounts that misuse the system.</li>
        <li><b>Your account.</b> Keep access to your email or Google account secure; bookings made from your account are yours.</li>
        <li><b>Privacy.</b> How we handle your data is described in our <a className="underline" href="/privacy">privacy policy</a>.</li>
        <li><b>Contact.</b> <a className="underline" href="mailto:hello@thesparkcentre.in">hello@thesparkcentre.in</a> · ITPL Main Rd, Whitefield, Bengaluru.</li>
      </ul>
    </div>
  );
}
