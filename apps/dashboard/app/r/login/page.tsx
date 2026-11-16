import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { StaffLogin } from "@/components/suite/login";
import { customerSlug } from "@/lib/hosts";
import { type PublicStore, themeStyle } from "@/lib/suite";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";
const ESPRESSO = { primary: "#B4531F", accent: "#E9B87A", ink: "#2B1D14", background: "#FAF6F1", text: "#2B1D14" };

/** Staff sign-in for one restaurant, at <host>/admin/login. On our own host staff use the ordinary /login. */
export default async function StaffLoginPage() {
  const slug = customerSlug((await headers()).get("host") ?? "");
  if (!slug) redirect("/login");
  // The restaurant's name and colours are public when it has an ordering site; without one the form stays neutral.
  const store = await fetch(`${API_INTERNAL_URL}/v1/store/${encodeURIComponent(slug)}`, { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<PublicStore>) : null))
    .catch(() => null);
  const name = store?.name ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return <StaffLogin name={name} style={themeStyle(store?.theme ?? ESPRESSO)} next="/admin" />;
}
