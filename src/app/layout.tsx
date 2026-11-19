import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { PwaSetup } from "@/components/pwa";

const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "the*spark Pullur Centre — book a seat",
  description: "Live seat and room booking for the*spark Pullur Centre, Whitefield.",
  applicationName: "the*spark",
  appleWebApp: { capable: true, title: "the*spark", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f9f1e8",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${montserrat.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          {children}
          <PwaSetup />
        </AuthProvider>
      </body>
    </html>
  );
}
