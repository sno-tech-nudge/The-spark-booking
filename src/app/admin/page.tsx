import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin-console";

export const metadata: Metadata = { title: "Admin · the*spark centre" };

export default function AdminPage() {
  return <AdminConsole />;
}
