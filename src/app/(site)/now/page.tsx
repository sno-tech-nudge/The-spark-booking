import type { Metadata } from "next";
import { NowBoard } from "@/components/now-board";

export const metadata: Metadata = { title: "Live now · the*spark centre" };

export default function NowPage() {
  return <NowBoard />;
}
