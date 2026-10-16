import type { ReactNode } from "react";
import { Shell } from "@/components/shell";

export const metadata = { title: "Orders" };

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>;
}
