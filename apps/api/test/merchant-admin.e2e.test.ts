import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FakeSender } from "@ordr/whatsapp";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { loadConfig } from "../src/config";

const EMAIL = "owner@demo.test";
const PASSWORD = "very-secret-password";

async function createApp(): Promise<INestApplication> {
  const config = loadConfig({
    META_APP_SECRET: "test-app-secret",
    META_VERIFY_TOKEN: "test-verify-token",
    STORAGE: "memory",
    WHATSAPP_SENDER: "log",
    SEED_ADMIN_EMAIL: EMAIL,
    SEED_ADMIN_PASSWORD: PASSWORD,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ config, overrides: { sender: new FakeSender() } })] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe("merchant catalog and staff API", () => {
  let app: INestApplication;
  let auth: { authorization: string };
  const server = () => app.getHttpServer();

  beforeEach(async () => {
    app = await createApp();
    const res = await request(server()).post("/merchant/auth/login").send({ email: EMAIL, password: PASSWORD });
    auth = { authorization: `Bearer ${res.body.token as string}` };
  });
  afterEach(async () => {
    await app.close();
  });

  it("lists the demo catalog and edits categories and offerings with modifiers", async () => {
    const all = await request(server()).get("/merchant/catalog").set(auth);
    expect(all.status).toBe(200);
    expect(all.body.categories.length).toBeGreaterThan(0);
    expect(all.body.offerings.length).toBeGreaterThan(0);

    const cat = await request(server()).post("/merchant/catalog/categories").set(auth).send({ name: { en: "Specials", ar: "عروض" } });
    expect(cat.status).toBe(201);
    expect(cat.body).toMatchObject({ name: { en: "Specials", ar: "عروض" }, isActive: true });

    const bad = await request(server()).post("/merchant/catalog/categories").set(auth).send({ name: { en: "" } });
    expect(bad.status).toBe(400);

    const item = await request(server())
      .post("/merchant/catalog/offerings")
      .set(auth)
      .send({
        categoryId: cat.body.id,
        name: { en: "Truffle fries" },
        description: { en: "With parmesan", ar: "" },
        priceMinor: 2500,
        modifierGroups: [{ name: { en: "Size" }, minSelect: 1, maxSelect: 1, options: [{ name: { en: "Regular" } }, { name: { en: "Large" }, priceDeltaMinor: 500 }] }],
      });
    expect(item.status).toBe(201);
    expect(item.body).toMatchObject({ priceMinor: 2500, currency: "AED", isActive: true, description: { en: "With parmesan" } });
    expect(item.body.modifierGroups[0].options.map((o: { priceDeltaMinor: number }) => o.priceDeltaMinor)).toEqual([0, 500]);

    const wrongCategory = await request(server()).post("/merchant/catalog/offerings").set(auth).send({ categoryId: "nope", name: { en: "x" }, priceMinor: 1 });
    expect(wrongCategory.status).toBe(400);

    const patched = await request(server())
      .patch(`/merchant/catalog/offerings/${item.body.id}`)
      .set(auth)
      .send({ priceMinor: 2700, isActive: false, modifierGroups: [] });
    expect(patched.body).toMatchObject({ priceMinor: 2700, isActive: false, modifierGroups: [] });

    const archived = await request(server()).patch(`/merchant/catalog/categories/${cat.body.id}`).set(auth).send({ isActive: false, name: { en: "Old specials" } });
    expect(archived.body).toMatchObject({ isActive: false, name: { en: "Old specials" } });
    expect((await request(server()).patch("/merchant/catalog/offerings/nope").set(auth).send({ priceMinor: 1 })).status).toBe(404);
  });

  it("lets owners manage staff and everyone change their own password", async () => {
    const created = await request(server()).post("/merchant/users").set(auth).send({ email: "Staff@Demo.test", name: "Sam", role: "staff" });
    expect(created.status).toBe(201);
    expect(created.body.user).toMatchObject({ email: "staff@demo.test", role: "staff", isActive: true });
    const temp = created.body.temporaryPassword as string;
    expect(temp).toHaveLength(14);
    expect((await request(server()).post("/merchant/users").set(auth).send({ email: "staff@demo.test", name: "Dup" })).status).toBe(409);

    const staffLogin = await request(server()).post("/merchant/auth/login").send({ email: "staff@demo.test", password: temp });
    expect(staffLogin.status).toBe(200);
    const staffAuth = { authorization: `Bearer ${staffLogin.body.token as string}` };
    expect((await request(server()).get("/merchant/users").set(staffAuth)).status).toBe(403);

    const change = await request(server()).post("/merchant/me/password").set(staffAuth).send({ currentPassword: temp, newPassword: "a-brand-new-password" });
    expect(change.status).toBe(204);
    expect((await request(server()).post("/merchant/me/password").set(staffAuth).send({ currentPassword: temp, newPassword: "another-one-again" })).status).toBe(403);
    expect((await request(server()).post("/merchant/auth/login").send({ email: "staff@demo.test", password: "a-brand-new-password" })).status).toBe(200);

    const reset = await request(server()).post(`/merchant/users/${created.body.user.id}/reset-password`).set(auth);
    expect(reset.body.temporaryPassword).toHaveLength(14);
    expect((await request(server()).post("/merchant/auth/login").send({ email: "staff@demo.test", password: "a-brand-new-password" })).status).toBe(401);

    const deactivated = await request(server()).patch(`/merchant/users/${created.body.user.id}`).set(auth).send({ isActive: false });
    expect(deactivated.body.isActive).toBe(false);
    expect((await request(server()).get("/merchant/me").set(staffAuth)).status).toBe(401);

    const list = await request(server()).get("/merchant/users").set(auth);
    expect(list.body.users.map((u: { email: string }) => u.email).sort()).toEqual([EMAIL, "staff@demo.test"]);
    const me = list.body.users.find((u: { email: string }) => u.email === EMAIL);
    expect((await request(server()).patch(`/merchant/users/${me.id}`).set(auth).send({ isActive: false })).status).toBe(400);
  });
});
