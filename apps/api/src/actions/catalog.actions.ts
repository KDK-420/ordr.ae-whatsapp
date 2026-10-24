import { formatMoney, localized } from "@ordr/domain";
import type { DynamicRow, ImageRow, MapActionRegistry } from "@ordr/flow-schema";
import type { CatalogRepository } from "../ports";

/** One photo per active item that has one: the picture with name, price and a line of description as its caption. */
export function photoRows(offerings: Array<{ imageUrl?: string; isActive: boolean; name: Record<string, string>; description?: Record<string, string>; priceMinor: number; currency: string; type: string }>, language: string, max = 10): ImageRow[] {
  return offerings
    .filter((o) => o.isActive && o.imageUrl)
    .slice(0, max)
    .map((o) => {
      const desc = localized(o.description, language);
      const price = `${formatMoney(o.priceMinor, o.currency)}${o.type === "stay" ? (language === "ar" ? " / الليلة" : " / night") : ""}`;
      return { link: o.imageUrl!, caption: [`*${localized(o.name, language)}* · ${price}`, desc].filter(Boolean).join("\n") };
    });
}

export function registerCatalogActions(registry: MapActionRegistry, catalog: CatalogRepository): void {
  /** Photos of the catalog (one category when `categoryId` is given), for an `images` node. */
  registry.register("catalog.photos", async (params, ctx): Promise<ImageRow[]> => {
    const categoryId = params.categoryId ? String(params.categoryId) : undefined;
    const offerings = categoryId ? await catalog.listOfferings(ctx.tenantId, categoryId) : (await catalog.listAllOfferings(ctx.tenantId)).filter((o) => o.isActive);
    return photoRows(offerings, ctx.language);
  });

  registry.register("catalog.categories", async (_params, ctx): Promise<DynamicRow[]> => {
    const categories = await catalog.listCategories(ctx.tenantId);
    return categories.map((c) => ({ id: c.id, title: localized(c.name, ctx.language) }));
  });

  registry.register("catalog.items", async (params, ctx): Promise<DynamicRow[]> => {
    const offerings = await catalog.listOfferings(ctx.tenantId, String(params.categoryId ?? ""));
    return offerings.map((o) => {
      const desc = localized(o.description, ctx.language);
      return {
        id: o.id,
        title: localized(o.name, ctx.language),
        description: desc ? `${formatMoney(o.priceMinor, o.currency)}, ${desc}` : formatMoney(o.priceMinor, o.currency),
      };
    });
  });
}
