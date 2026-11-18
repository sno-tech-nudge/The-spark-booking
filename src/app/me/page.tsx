import type { Metadata } from "next";
import { MyBookings } from "@/components/my-bookings";

export const metadata: Metadata = { title: "My bookings · the*spark centre" };

export default function MePage() {
  return <MyBookings />;
}
