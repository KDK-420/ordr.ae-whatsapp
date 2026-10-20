import type { Category, Offering } from "@ordr/domain";

/**
 * Demo shop used by the in-memory catalog (web chat demo, tests) and by the Prisma seed when
 * SEED_BLUEPRINT_ID=retail. Products carry stock and variants so checkout can be exercised.
 */
export function demoRetailCatalog(tenantId: string): { categories: Category[]; offerings: Offering[]; resources: never[] } {
  const categories: Category[] = [
    { id: "cat_coffee", tenantId, name: { en: "Coffee", ar: "قهوة" }, sortOrder: 1, isActive: true },
    { id: "cat_shoes", tenantId, name: { en: "Running shoes", ar: "أحذية جري" }, sortOrder: 2, isActive: true },
  ];

  const product = (id: string, categoryId: string, name: Offering["name"], priceMinor: number, sortOrder: number, extra: Partial<Offering> = {}): Offering => ({
    id,
    tenantId,
    categoryId,
    type: "product",
    name,
    priceMinor,
    currency: "AED",
    sortOrder,
    isActive: true,
    modifierGroups: [],
    ...extra,
  });

  const offerings: Offering[] = [
    product("prd_ethiopia", "cat_coffee", { en: "Ethiopia Yirgacheffe", ar: "إثيوبيا يرغاتشيف" }, 6500, 1, {
      description: { en: "Washed, floral and citrus. Roasted this week.", ar: "مغسولة، زهرية وحمضية. محمصة هذا الأسبوع." },
      variants: [
        { id: "var_eth_250", name: { en: "250 g", ar: "٢٥٠ غ" }, priceMinor: 6500, stock: 12, sortOrder: 1, isActive: true },
        { id: "var_eth_1kg", name: { en: "1 kg", ar: "١ كغ" }, priceMinor: 22000, stock: 3, sortOrder: 2, isActive: true },
      ],
    }),
    product("prd_colombia", "cat_coffee", { en: "Colombia Huila", ar: "كولومبيا هويلا" }, 5500, 2, {
      description: { en: "Chocolate and red fruit. Great for espresso.", ar: "شوكولاتة وفواكه حمراء. ممتازة للإسبريسو." },
      stock: 20,
    }),
    product("prd_decaf", "cat_coffee", { en: "Decaf Brazil", ar: "برازيل منزوعة الكافيين" }, 5000, 3, { description: { en: "Swiss water process, nutty and sweet.", ar: "معالجة بالماء، جوزية وحلوة." }, stock: 0 }),
    product("prd_runner", "cat_shoes", { en: "Cloud Runner", ar: "كلاود رانر" }, 45000, 4, {
      description: { en: "Lightweight daily trainer, neutral support.", ar: "حذاء تدريب يومي خفيف، دعم محايد." },
      variants: [
        { id: "var_run_41", name: { en: "EU 41", ar: "٤١" }, stock: 2, sortOrder: 1, isActive: true },
        { id: "var_run_42", name: { en: "EU 42", ar: "٤٢" }, stock: 5, sortOrder: 2, isActive: true },
        { id: "var_run_43", name: { en: "EU 43", ar: "٤٣" }, stock: 0, sortOrder: 3, isActive: true },
      ],
    }),
  ];

  return { categories, offerings, resources: [] };
}
