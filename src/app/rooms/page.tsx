import type { Metadata } from "next";
import { BookRoom } from "@/components/book-room";

export const metadata: Metadata = { title: "Rooms · the*spark centre" };

export default function RoomsPage() {
  return <BookRoom />;
}
