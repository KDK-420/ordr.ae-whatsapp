import { getBlueprint } from "@ordr/blueprints";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaNumberPoolRepository, PrismaTenantRepository, PrismaUserRepository } from "../../src/adapters/prisma";
import { PrismaCatalogRepository, PrismaResourceRepository } from "../../src/adapters/prisma-catalog";
import { PrismaPropertyRepository } from "../../src/adapters/prisma-stays";
import { PrismaInventoryRepository, PrismaSuiteRepository } from "../../src/adapters/prisma-suite";
import { AdminService } from "../../src/admin/admin.service";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const created: string[] = [];

afterAll(async () => {
  const where = { tenantId: { in: created } };
  await prisma.stockMovement.deleteMany({ where });
  await prisma.stockLevel.deleteMany({ where });
  await prisma.recipeLine.deleteMany({ where });
  await prisma.supplier.deleteMany({ where });
  await prisma.stockItem.deleteMany({ where });
  await prisma.branch.deleteMany({ where });
  await prisma.offering.deleteMany({ where });
  await prisma.category.deleteMany({ where });
  await prisma.user.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("Admin: a merchant created with the coffee shop demo, on Postgres", () => {
  it("gets its own menu, stations, stock and every recipe line, including the ones that depend on an option", async () => {
    const inventory = new PrismaInventoryRepository(prisma);
    const suite = new PrismaSuiteRepository(prisma);
    const catalog = new PrismaCatalogRepository(prisma);
    const admin = new AdminService(new PrismaTenantRepository(prisma, 0), new PrismaUserRepository(prisma), catalog, new PrismaResourceRepository(prisma), new PrismaPropertyRepository(prisma), new PrismaNumberPoolRepository(prisma), { get: getBlueprint }, suite, inventory);

    const { tenant } = await admin.createTenant({ name: `Harbour Coffee ${suffix}`, blueprintId: "restaurant", ownerEmail: `owner-${suffix}@harbour.test`, ownerName: "Hana", demoSet: "coffee", swatch: "ocean", modules: ["pos", "kds", "inventory"] });
    created.push(tenant.id);
    expect(tenant.settings).toMatchObject({ modules: ["pos", "kds", "inventory"], theme: { swatch: "ocean" }, vatInclusive: false });

    const offerings = await catalog.listAllOfferings(tenant.id);
    expect(offerings).toHaveLength(14);
    const latte = offerings.find((o) => o.name.en === "Latte")!;
    const optionIds = new Set(latte.modifierGroups.flatMap((g) => g.options.map((o) => o.id)));
    const large = latte.modifierGroups.flatMap((g) => g.options).find((o) => o.name.en === "Large")!;

    // Stored names come back with their languages reordered; the recipes must still find their options.
    const recipes = await inventory.recipes(tenant.id);
    expect(recipes).toHaveLength(60);
    const forLatte = recipes.filter((r) => r.offeringId === latte.id);
    expect(forLatte.filter((r) => r.modifierOptionId).every((r) => optionIds.has(r.modifierOptionId!))).toBe(true);
    expect(forLatte.find((r) => r.modifierOptionId === large.id && r.appliesTo === "takeaway")).toBeDefined();

    const [branch] = await suite.listBranches(tenant.id);
    const categoryIds = new Set((await catalog.listCategories(tenant.id)).map((c) => c.id));
    expect(branch!.stations.map((s) => [s.name, s.categoryIds.length, s.categoryIds.every((c) => categoryIds.has(c))])).toEqual([["Bar", 2, true], ["Bakery", 2, true]]);

    const items = await inventory.listItems(tenant.id);
    expect(items).toHaveLength(16);
    const levels = await inventory.levels(tenant.id, branch!.id);
    const beans = items.find((i) => i.name.startsWith("Arabica"))!;
    expect(levels.get(beans.id)).toBe(24_000);
    expect(await inventory.listSuppliers(tenant.id)).toHaveLength(3);
  });
});
