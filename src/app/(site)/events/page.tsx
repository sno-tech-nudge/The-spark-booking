import type { Metadata } from "next";
import { EventsPage } from "@/components/events";

export const metadata: Metadata = { title: "Events · the*spark centre" };

export default function Events() {
  return <EventsPage />;
}
