import type { Metadata } from "next";
import { ReceptionScreen } from "@/components/reception-screen";

export const metadata: Metadata = {
  title: "Reception screen · the*spark",
  robots: { index: false, follow: false },
};

// Opened from Admin → "Reception screen". Public (no sign-in) and shows nothing private.
export default function DisplayPage() {
  return <ReceptionScreen />;
}
