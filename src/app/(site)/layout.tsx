import { SiteHeader } from "@/components/site-header";
import { SetupBanner } from "@/components/setup-banner";
import { Wordmark } from "@/components/brand";
import { HoldBanner } from "@/components/hold-timer";
import { AnnouncementBanner } from "@/components/announcements";
import { TabBar } from "@/components/tab-bar";

// The website chrome (header, notices, footer, phone tab bar). The reception
// screen at /display lives outside this group so it can be full-screen.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SetupBanner />
      <SiteHeader />
      <HoldBanner />
      <AnnouncementBanner />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-paper/10 bg-ink text-paper/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 py-10 text-xs">
          <div className="space-y-3">
            <span className="text-2xl"><Wordmark tone="dark" sub /></span>
            <p className="font-serif text-sm italic text-spark">connect · collaborate · change</p>
          </div>
          <div className="space-y-1 text-right">
            <p>ITPL Main Rd, Whitefield, Bengaluru</p>
            <p>Mon–Sat · 9am – 6pm · prices excl. GST</p>
            <p className="space-x-3"><a className="hover:text-spark" href="/privacy">Privacy</a><a className="hover:text-spark" href="/terms">Terms</a></p>
            <p className="text-paper/35">Booking prototype v1</p>
          </div>
        </div>
      </footer>
      <TabBar />
    </>
  );
}
