import type { MetadataRoute } from "next";

/** Lets staff add the dashboard to a phone's home screen; iOS only delivers Web Push to such an installed app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ordr.ae",
    short_name: "ordr.ae",
    description: "WhatsApp ordering for restaurants, salons and clinics in the UAE.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16a34a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
