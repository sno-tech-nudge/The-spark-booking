"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-provider";
import { SparkMark } from "./brand";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const SEAT = "M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5M4 11h16v4H4zM6 15v5M18 15v5";
const ROOM = "M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M14 12h.01";
const ME = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0";
const ADMIN = "M4 6h16M4 12h16M4 18h10";

/** Phone-style bottom navigation (mobile only), with the live asterisk in the middle. */
export function TabBar() {
  const path = usePathname();
  const { user, profile } = useAuth();
  const tabs = [
    { href: "/book", label: "Seats", icon: <Icon d={SEAT} /> },
    { href: "/rooms", label: "Rooms", icon: <Icon d={ROOM} /> },
    { href: "/now", label: "Live", icon: <SparkMark className="h-6 w-6" />, center: true },
    { href: user ? "/me" : "/login?next=/me", match: "/me", label: user ? "Mine" : "Sign in", icon: <Icon d={ME} /> },
    ...(profile?.role === "admin" ? [{ href: "/admin", label: "Admin", icon: <Icon d={ADMIN} /> }] : []),
  ];
  return (
    <>
      <div className="h-[calc(68px+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-sand/80 bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {tabs.map((t) => {
            const active = path.startsWith(("match" in t && t.match) || t.href.split("?")[0]);
            return (
              <li key={t.label} className="flex-1">
                <Link href={t.href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] uppercase tracking-[0.08em] ${active ? "text-ink" : "text-ink/45"}`}>
                  {"center" in t && t.center ? (
                    <span className={`-mt-6 grid h-12 w-12 place-items-center rounded-full shadow-md ring-4 ring-paper ${active ? "bg-ink text-spark" : "bg-spark text-white"}`}>
                      <SparkMark className={`h-6 w-6 ${active ? "spark-spin [animation-duration:6s]" : ""}`} />
                    </span>
                  ) : (
                    <span className={active ? "text-spark-dark" : ""}>{t.icon}</span>
                  )}
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
