import type { Category, Offering, Resource } from "@ordr/domain";

/**
 * Demo salon used by the in-memory catalog (simulator, tests) and by the Prisma seed when
 * SEED_BLUEPRINT_ID=salon. Ids are stable so tests can reference them.
 */
export function demoSalonCatalog(tenantId: string): { categories: Category[]; offerings: Offering[]; resources: Resource[] } {
  const categories: Category[] = [
    { id: "cat_hair", tenantId, name: { en: "Hair", ar: "الشعر" }, sortOrder: 1, isActive: true },
    { id: "cat_nails", tenantId, name: { en: "Nails", ar: "الأظافر" }, sortOrder: 2, isActive: true },
  ];

  const service = (id: string, categoryId: string, name: Offering["name"], priceMinor: number, durationMinutes: number, sortOrder: number, description?: Offering["description"]): Offering => ({
    id,
    tenantId,
    categoryId,
    type: "service",
    name,
    description,
    priceMinor,
    currency: "AED",
    durationMinutes,
    sortOrder,
    isActive: true,
    modifierGroups: [],
  });

  const offerings: Offering[] = [
    service("svc_haircut", "cat_hair", { en: "Haircut", ar: "قص شعر" }, 8000, 45, 1, { en: "Wash, cut and style", ar: "غسيل وقص وتصفيف" }),
    service("svc_blowdry", "cat_hair", { en: "Blow dry", ar: "تصفيف بالمجفف" }, 6000, 30, 2),
    service("svc_color", "cat_hair", { en: "Colour", ar: "صبغة" }, 25000, 90, 3, { en: "Full head, includes toner", ar: "كامل الشعر مع تونر" }),
    service("svc_manicure", "cat_nails", { en: "Manicure", ar: "مانيكير" }, 7000, 40, 4),
    service("svc_pedicure", "cat_nails", { en: "Pedicure", ar: "باديكير" }, 9000, 50, 5),
  ];

  const resources: Resource[] = [
    {
      id: "res_sara",
      tenantId,
      type: "staff",
      name: { en: "Sara", ar: "سارة" },
      hours: { mon: [{ start: "10:00", end: "20:00" }], tue: [{ start: "10:00", end: "20:00" }], wed: [{ start: "10:00", end: "20:00" }], thu: [{ start: "10:00", end: "20:00" }], fri: [{ start: "14:00", end: "22:00" }], sat: [{ start: "10:00", end: "20:00" }] },
      skills: [],
      sortOrder: 1,
      isActive: true,
    },
    {
      id: "res_mona",
      tenantId,
      type: "staff",
      name: { en: "Mona", ar: "منى" },
      hours: { tue: [{ start: "12:00", end: "21:00" }], wed: [{ start: "12:00", end: "21:00" }], thu: [{ start: "12:00", end: "21:00" }], fri: [{ start: "14:00", end: "22:00" }], sat: [{ start: "12:00", end: "21:00" }], sun: [{ start: "12:00", end: "21:00" }] },
      skills: ["svc_haircut", "svc_blowdry", "svc_color"],
      sortOrder: 2,
      isActive: true,
    },
  ];

  return { categories, offerings, resources };
}
