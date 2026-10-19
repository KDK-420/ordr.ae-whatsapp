import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaNumberPoolRepository, PrismaTenantRepository, PrismaUserRepository } from "../../src/adapters/prisma";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const created: string[] = [];

afterAll(async () => {
  await prisma.phoneNumber.deleteMany({ where: { phoneNumberId: { startsWith: `pn_${suffix}` } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: created } } });
  await prisma.channel.deleteMany({ where: { tenantId: { in: created } } });
  await prisma.tenant.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

describe("Prisma tenants, channels and the number pool", () => {
  it("creates tenants, moves a number between them and stops routing when released", async () => {
    const tenants = new PrismaTenantRepository(prisma, 0);
    const pool = new PrismaNumberPoolRepository(prisma);
    const users = new PrismaUserRepository(prisma);

    const a = await tenants.create({ name: "Pool A", slug: `pool-a-${suffix}`, blueprintId: "salon" });
    const b = await tenants.create({ name: "Pool B", slug: `pool-b-${suffix}`, blueprintId: "restaurant", defaultLanguage: "ar" });
    created.push(a.id, b.id);
    expect(b).toMatchObject({ blueprintId: "restaurant", defaultLanguage: "ar", timezone: "Asia/Dubai", settings: {} });

    const number = await pool.create({ phoneNumberId: `pn_${suffix}`, wabaId: "w", displayPhone: "+9715000", accessToken: "tok", label: "SIM" });
    expect(number).toMatchObject({ tenantId: null, label: "SIM" });

    const channel = await tenants.attachChannel(a.id, number);
    await pool.setTenant(number.id, a.id);
    expect(channel).toMatchObject({ tenantId: a.id, phoneNumberId: `pn_${suffix}`, status: "active" });
    expect((await tenants.findByPhoneNumberId(`pn_${suffix}`))?.tenant.id).toBe(a.id);
    expect((await tenants.findContextById(a.id))?.channel.id).toBe(channel.id);

    // Moving the number keeps the channel row (conversations reference it) but changes its tenant.
    const moved = await tenants.attachChannel(b.id, number);
    expect(moved.id).toBe(channel.id);
    expect((await tenants.findByPhoneNumberId(`pn_${suffix}`))?.tenant.id).toBe(b.id);
    expect(await tenants.findContextById(a.id)).toBeNull();

    await tenants.detachChannel(`pn_${suffix}`);
    expect(await tenants.findByPhoneNumberId(`pn_${suffix}`)).toBeNull();
    expect(await tenants.findContextById(b.id)).toBeNull();
    expect((await pool.setTenant(number.id, null))?.tenantId).toBeNull();
    expect(await pool.setTenant("nope", null)).toBeNull();

    const listed = await tenants.list();
    const mine = listed.filter((t) => created.includes(t.tenant.id));
    expect(mine.map((t) => t.tenant.slug)).toEqual([`pool-b-${suffix}`, `pool-a-${suffix}`]);
    expect(mine.every((t) => t.channel === null)).toBe(true);

    const admin = await users.create({ tenantId: a.id, email: `ops-${suffix}@x.test`, name: "Ops", role: "owner", passwordHash: "h", isPlatformAdmin: true });
    expect(admin.isPlatformAdmin).toBe(true);
    expect((await users.findById(admin.id))?.isPlatformAdmin).toBe(true);
  });
});
