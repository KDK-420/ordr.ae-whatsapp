import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { demoDataFor } from "../src/actions/demo";
import { hashPassword } from "../src/auth/password";

const prisma = new PrismaClient();

async function main() {
  const env = process.env;
  const name = env.SEED_TENANT_NAME ?? "Demo Restaurant";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
  const demo = demoDataFor(blueprintId, tenant.id);
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
    `Seeded tenant "${tenant.name}" (${tenant.id}, ${blueprintId}) with channel ${phoneNumberId}, ${demo.categories.length} categories, ${demo.offerings.length} offerings and ${demo.resources.length} resources`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
