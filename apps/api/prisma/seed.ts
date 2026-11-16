import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { demoDataFor } from "../src/actions/demo";
import type { CoffeeDemo } from "../src/actions/demo-coffee";
import { hashPassword } from "../src/auth/password";

const prisma = new PrismaClient();

/**
 * The restaurant suite demo: modules and theme on the tenant, a branch with stations, stock,
 * recipes and suppliers. Safe to run again: rows are upserted and opening stock is written once.
 */
async function seedSuite(tenantId: string, suite: CoffeeDemo) {
  const current = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  // Keep whatever the owner already changed; the demo only fills what is missing.
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...suite.settings, ...((current.settings as Record<string, unknown>) ?? {}) } as Prisma.InputJsonValue } });
  for (const b of suite.branches) {
    const data = { name: b.name, address: b.address ?? null, phone: b.phone ?? null, stations: b.stations as unknown as Prisma.InputJsonValue, sortOrder: b.sortOrder, isActive: b.isActive };
    await prisma.branch.upsert({ where: { id: b.id }, update: data, create: { id: b.id, tenantId, ...data } });
  }
  for (const i of suite.stockItems) {
    const data = { name: i.name, category: i.category ?? null, kind: i.kind, baseUnit: i.baseUnit, unitLabel: i.unitLabel, unitSize: i.unitSize, reorderLevel: i.reorderLevel, costMinor: i.costMinor, isActive: i.isActive };
    await prisma.stockItem.upsert({ where: { id: i.id }, update: data, create: { id: i.id, tenantId, ...data } });
  }
  for (const s of suite.suppliers) {
    const data = { name: s.name, phone: s.phone ?? null, email: s.email ?? null, leadDays: s.leadDays ?? null, isActive: s.isActive };
    await prisma.supplier.upsert({ where: { id: s.id }, update: data, create: { id: s.id, tenantId, ...data } });
  }
  await prisma.recipeLine.deleteMany({ where: { tenantId, id: { startsWith: "rcp_" } } });
  await prisma.recipeLine.createMany({ data: suite.recipeLines.map((l) => ({ id: `${l.id}_${tenantId}`.slice(0, 60), tenantId, offeringId: l.offeringId, modifierOptionId: l.modifierOptionId ?? null, stockItemId: l.stockItemId, quantity: l.quantity, appliesTo: l.appliesTo })), skipDuplicates: true });
  const branchId = suite.branches[0]!.id;
  if ((await prisma.stockMovement.count({ where: { tenantId } })) === 0) {
    const sizes = new Map(suite.stockItems.map((i) => [i.id, i.unitSize]));
    for (const o of suite.opening.filter((x) => x.units > 0)) {
      const quantity = o.units * (sizes.get(o.stockItemId) ?? 1);
      await prisma.stockMovement.create({ data: { tenantId, branchId, stockItemId: o.stockItemId, type: "count", quantity, note: "Opening stock" } });
      await prisma.stockLevel.upsert({ where: { branchId_stockItemId: { branchId, stockItemId: o.stockItemId } }, create: { branchId, stockItemId: o.stockItemId, tenantId, onHand: quantity }, update: { onHand: quantity } });
    }
  }
  console.log(`Suite demo: ${suite.branches.length} branch(es), ${suite.stockItems.length} stock items, ${suite.recipeLines.length} recipe lines, ${suite.suppliers.length} suppliers`);
}

async function main() {
  const env = process.env;
  const name = env.SEED_TENANT_NAME ?? "Demo Restaurant";
  const slug = env.SEED_TENANT_SLUG?.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: { name, blueprintId: env.SEED_BLUEPRINT_ID ?? "restaurant" },
    create: { name, slug, blueprintId: env.SEED_BLUEPRINT_ID ?? "restaurant" },
  });
  const phoneNumberId = env.SEED_PHONE_NUMBER_ID ?? "000000000000000";
  await prisma.channel.upsert({
    where: { phoneNumberId },
    // The seeded tenant owns the number; reseeding under a new tenant name moves it along.
    update: { tenantId: tenant.id, accessToken: env.SEED_ACCESS_TOKEN ?? "replace-me" },
    create: {
      tenantId: tenant.id,
      phoneNumberId,
      wabaId: env.SEED_WABA_ID ?? "000000000000000",
      displayPhone: env.SEED_DISPLAY_PHONE ?? "+971500000000",
      accessToken: env.SEED_ACCESS_TOKEN ?? "replace-me",
    },
  });
  // Dashboard owner. The password is only (re)set when SEED_ADMIN_PASSWORD is present.
  const adminEmail = env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = hashPassword(adminPassword);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, tenantId: tenant.id, role: "owner", isActive: true, isPlatformAdmin: true },
      create: { tenantId: tenant.id, email: adminEmail, name: env.SEED_ADMIN_NAME ?? "Owner", role: "owner", passwordHash, isPlatformAdmin: true },
    });
    console.log(`Dashboard owner ${adminEmail} is ready`);
  } else {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no dashboard user created");
  }
  const blueprintId = env.SEED_BLUEPRINT_ID ?? "restaurant";
  const demo = demoDataFor(blueprintId, tenant.id, env.SEED_DEMO === "coffee" ? "coffee" : undefined);
  if (demo.suite) await seedSuite(tenant.id, demo.suite);
  for (const p of demo.properties) {
    const data = { name: p.name, description: p.description ?? Prisma.JsonNull, address: p.address ?? null, mapsUrl: p.mapsUrl ?? null, phone: p.phone ?? null, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, amenities: p.amenities, imageUrls: p.imageUrls, sortOrder: p.sortOrder, isActive: p.isActive };
    await prisma.property.upsert({ where: { id: p.id }, update: data, create: { id: p.id, tenantId: tenant.id, ...data } });
  }
  for (const c of demo.categories) {
    await prisma.category.upsert({
      where: { id: c.id },
      update: { name: c.name, sortOrder: c.sortOrder, isActive: c.isActive },
      create: { id: c.id, tenantId: tenant.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive },
    });
  }
  for (const o of demo.offerings) {
    await prisma.offering.upsert({
      where: { id: o.id },
      update: {
        name: o.name,
        description: o.description ?? Prisma.JsonNull,
        type: o.type,
        priceMinor: o.priceMinor,
        durationMinutes: o.durationMinutes ?? null,
        stock: o.stock ?? null,
        imageUrl: o.imageUrl ?? null,
        propertyId: o.propertyId ?? null,
        maxGuests: o.maxGuests ?? null,
        units: o.units ?? null,
        sortOrder: o.sortOrder,
        isActive: o.isActive,
        categoryId: o.categoryId,
      },
      create: {
        id: o.id,
        tenantId: tenant.id,
        categoryId: o.categoryId,
        type: o.type,
        name: o.name,
        description: o.description ?? Prisma.JsonNull,
        priceMinor: o.priceMinor,
        currency: o.currency,
        durationMinutes: o.durationMinutes ?? null,
        stock: o.stock ?? null,
        imageUrl: o.imageUrl ?? null,
        propertyId: o.propertyId ?? null,
        maxGuests: o.maxGuests ?? null,
        units: o.units ?? null,
        sortOrder: o.sortOrder,
        isActive: o.isActive,
      },
    });
    for (const v of o.variants ?? []) {
      await prisma.productVariant.upsert({
        where: { id: v.id },
        update: { name: v.name, sku: v.sku ?? null, priceMinor: v.priceMinor ?? null, stock: v.stock ?? null, sortOrder: v.sortOrder, isActive: v.isActive },
        create: { id: v.id, tenantId: tenant.id, offeringId: o.id, name: v.name, sku: v.sku ?? null, priceMinor: v.priceMinor ?? null, stock: v.stock ?? null, sortOrder: v.sortOrder, isActive: v.isActive },
      });
    }
    await prisma.modifierGroup.deleteMany({ where: { offeringId: o.id } });
    for (const g of o.modifierGroups) {
      await prisma.modifierGroup.create({
        data: {
          id: g.id,
          tenantId: tenant.id,
          offeringId: o.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          sortOrder: g.sortOrder,
          options: { create: g.options.map((op) => ({ id: op.id, tenantId: tenant.id, name: op.name, priceDeltaMinor: op.priceDeltaMinor, sortOrder: op.sortOrder, isActive: op.isActive })) },
        },
      });
    }
  }
  for (const r of demo.resources) {
    await prisma.resource.upsert({
      where: { id: r.id },
      update: { name: r.name, type: r.type, hours: r.hours as Prisma.InputJsonValue, skills: r.skills as Prisma.InputJsonValue, sortOrder: r.sortOrder, isActive: r.isActive },
      create: { id: r.id, tenantId: tenant.id, name: r.name, type: r.type, hours: r.hours as Prisma.InputJsonValue, skills: r.skills as Prisma.InputJsonValue, sortOrder: r.sortOrder, isActive: r.isActive },
    });
  }
  console.log(
    `Seeded tenant "${tenant.name}" (${tenant.id}, ${blueprintId}) with channel ${phoneNumberId}, ${demo.categories.length} categories, ${demo.offerings.length} offerings, ${demo.resources.length} resources and ${demo.properties.length} properties`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
