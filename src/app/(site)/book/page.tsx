import type { Metadata } from "next";
import { BookSeat } from "@/components/book-seat";

export const metadata: Metadata = { title: "Book a seat · the*spark centre" };

export default function BookPage() {
  return <BookSeat />;
}
