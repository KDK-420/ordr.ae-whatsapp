"use client";

import { Catalog } from "@/components/catalog";
import { AppFrame, POS_NAV } from "@/components/suite/shell";

/** The menu editor, the same one the WhatsApp dashboard uses: items, photos, sizes and extras. */
export default function ProductsPage() {
  return (
    <AppFrame nav={POS_NAV} title="Products">
      <Catalog />
    </AppFrame>
  );
}
