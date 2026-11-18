import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { SiteHeader } from "@/components/site-header";
import { SetupBanner } from "@/components/setup-banner";

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "the*spark centre — book a seat",
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
          <footer className="border-t border-ink/10 py-8 text-center text-xs text-ink/50">
            the*spark Pullur Centre · ITPL Main Rd, Whitefield, Bengaluru · prototype v1 · prices excl. GST
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
