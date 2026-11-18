import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
import { SetupBanner } from "@/components/setup-banner";
import { Wordmark } from "@/components/brand";

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "the*spark Pullur Centre — book a seat",
  description: "Live seat and room booking for the*spark Pullur Centre, Whitefield.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <SetupBanner />
          <SiteHeader />
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
                <p className="text-paper/35">Booking prototype v1</p>
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
