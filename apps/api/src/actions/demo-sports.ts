import type { Category, Offering, Resource } from "@ordr/domain";
import type { WeeklyHours } from "@ordr/domain";

/**
 * Demo sports venue used by the in-memory catalog (simulator, tests) and by the Prisma seed when
 * SEED_BLUEPRINT_ID=sports. A court is a resource of type "asset"; each sport and duration is its
 * own offering, with `skills` keeping padel on the padel courts. Ids are stable so tests can use them.
 */
export function demoSportsCatalog(tenantId: string): { categories: Category[]; offerings: Offering[]; resources: Resource[] } {
  const categories: Category[] = [
    { id: "cat_padel", tenantId, name: { en: "Padel", ar: "بادل" }, sortOrder: 1, isActive: true },
    { id: "cat_tennis", tenantId, name: { en: "Tennis", ar: "تنس" }, sortOrder: 2, isActive: true },
    { id: "cat_football", tenantId, name: { en: "Football", ar: "كرة القدم" }, sortOrder: 3, isActive: true },
  ];

  const booking = (id: string, categoryId: string, name: Offering["name"], priceMinor: number, durationMinutes: number, sortOrder: number, description?: Offering["description"]): Offering => ({
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
    booking("svc_padel_60", "cat_padel", { en: "Padel 60 min", ar: "بادل 60 دقيقة" }, 20000, 60, 1, { en: "Whole court, up to 4 players", ar: "الملعب كاملاً، حتى 4 لاعبين" }),
    booking("svc_padel_90", "cat_padel", { en: "Padel 90 min", ar: "بادل 90 دقيقة" }, 28000, 90, 2, { en: "Whole court, up to 4 players", ar: "الملعب كاملاً، حتى 4 لاعبين" }),
    booking("svc_tennis_60", "cat_tennis", { en: "Tennis 60 min", ar: "تنس 60 دقيقة" }, 12000, 60, 3),
    booking("svc_football_60", "cat_football", { en: "Football 5-a-side 60 min", ar: "كرة قدم خماسية 60 دقيقة" }, 35000, 60, 4, { en: "Whole pitch, up to 10 players", ar: "الملعب كاملاً، حتى 10 لاعبين" }),
  ];

  const everyDay = { start: "07:00", end: "23:00" };
  const hours: WeeklyHours = { sun: [everyDay], mon: [everyDay], tue: [everyDay], wed: [everyDay], thu: [everyDay], fri: [everyDay], sat: [everyDay] };
  const court = (id: string, name: Resource["name"], skills: string[], sortOrder: number): Resource => ({ id, tenantId, type: "asset", name, hours, skills, sortOrder, isActive: true });

  const resources: Resource[] = [
    court("res_padel_1", { en: "Padel Court 1", ar: "ملعب البادل 1" }, ["svc_padel_60", "svc_padel_90"], 1),
    court("res_padel_2", { en: "Padel Court 2", ar: "ملعب البادل 2" }, ["svc_padel_60", "svc_padel_90"], 2),
    court("res_tennis_1", { en: "Tennis Court", ar: "ملعب التنس" }, ["svc_tennis_60"], 3),
    court("res_football_1", { en: "Football Pitch", ar: "ملعب كرة القدم" }, ["svc_football_60"], 4),
  ];

  return { categories, offerings, resources };
}
