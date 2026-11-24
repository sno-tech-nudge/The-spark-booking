"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { Spinner, Wordmark } from "./brand";

export function Logo({ className = "", sub = true }: { className?: string; sub?: boolean }) {
  return <Wordmark sub={sub} className={className} />;
}

export function SiteHeader() {
  const { ready, user, profile, signOut } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/book", label: "Book a seat" },
    { href: "/rooms", label: "Rooms" },
    { href: "/events", label: "Events" },
    { href: "/now", label: "Live now" },
    ...(user ? [{ href: "/me", label: "My bookings" }] : []),
    ...(profile?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-sand/70 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="text-[26px]" aria-label="the*spark Pullur Centre — home">
          <Logo />
        </Link>
        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-full px-3.5 py-1.5 text-[13px] transition ${
                path.startsWith(l.href) ? "bg-ink text-paper" : "text-ink/70 hover:bg-white/70 hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-2">
          {!ready ? (
            <Spinner className="h-6 w-6" />
          ) : user ? (
            <div className="relative">
              <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 rounded-full border border-ink/15 py-1 pl-1 pr-3 text-sm hover:bg-ink/5"
              >
                {profile?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover ring-2 ring-spark" />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-spark text-xs font-semibold text-ink">
                    {(profile?.full_name || user.email || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-32 truncate sm:inline">{profile?.full_name || user.email}</span>
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-ink/10 bg-white p-2 shadow-lg" onMouseLeave={() => setOpen(false)}>
                  <p className="truncate px-3 py-1 text-xs text-ink/50">{user.email}</p>
                  <p className="px-3 pb-2 text-xs capitalize text-ink/50">
                    {profile?.role === "guest" ? "Day pass / guest" : profile?.role}
                  </p>
                  {links.map((l) => (
                    <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm hover:bg-ink/5 md:hidden">
                      {l.label}
                    </Link>
                  ))}
                  <button
                    onClick={async () => {
                      setOpen(false);
                      await signOut();
                      router.push("/");
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/5"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" className="btn-spark text-sm">
              Sign in
            </Link>
          )}
        </div>
      </div>
      <nav className="hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${path.startsWith(l.href) ? "bg-ink text-paper" : "bg-ink/5 text-ink/70"}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
