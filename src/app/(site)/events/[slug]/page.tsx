import { Suspense } from "react";
import type { Metadata } from "next";
import { EventDetail } from "@/components/event-detail";
import { Loader } from "@/components/ui";

export const metadata: Metadata = { title: "Event · the*spark centre" };

// The event is loaded in the browser (live counters, your ticket), so the page itself is a shell.
export default function EventPage() {
  return (
    <Suspense fallback={<Loader label="Loading event" className="py-32" />}>
      <EventDetail />
    </Suspense>
  );
}
