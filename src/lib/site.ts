// The public address of the app. Calendar apps (Google, Apple) fetch feeds from
// their own servers, so feed links must point at a URL that isn't behind Vercel's
// login: the production domain, not the team/preview *.vercel.app addresses.
const PRODUCTION = "https://sparkbooking.vercel.app";

export function publicOrigin(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/$/, "");
  if (typeof window === "undefined") return PRODUCTION;
  const { host, origin } = window.location;
  return host.endsWith(".vercel.app") ? PRODUCTION : origin;
}
