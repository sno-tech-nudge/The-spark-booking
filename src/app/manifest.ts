import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "the*spark Pullur Centre",
    short_name: "the*spark",
    description: "Book seats and rooms at the*spark Pullur Centre — live, in seconds.",
    start_url: "/book?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f9f1e8",
    theme_color: "#f9f1e8",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Book a seat", url: "/book", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Live now", url: "/now", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My bookings", url: "/me", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
