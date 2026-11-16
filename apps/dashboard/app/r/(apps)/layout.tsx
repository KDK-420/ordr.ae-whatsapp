import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SuiteProvider } from "@/components/suite/shell";
import { customerSlug, staffBase } from "@/lib/hosts";

export const metadata: Metadata = { title: { default: "Staff", template: "%s | Staff" }, robots: { index: false } };

/** The restaurant's staff apps. Reached as <host>/admin on a restaurant's own host and as /r on ours. */
export default async function StaffAppsLayout({ children }: { children: ReactNode }) {
  const host = (await headers()).get("host") ?? "";
  return (
    <SuiteProvider base={staffBase(host)} hostSlug={customerSlug(host)}>
      {children}
    </SuiteProvider>
  );
}
