import { describe, expect, it } from "vitest";
import { demoSportsCatalog } from "../actions/demo-sports";
import { InMemoryTenantRepository } from "../adapters/memory";
import { InMemoryCatalogRepository } from "../adapters/memory-catalog";
import { InMemoryPropertyRepository } from "../adapters/memory-stays";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { SiteService } from "./site.service";

function setup(opts: { settings?: Record<string, unknown>; phoneNumberId?: string } = {}) {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory", SEED_BLUEPRINT_ID: "sports", SEED_TENANT_NAME: "Asian Sports", SEED_PHONE_NUMBER_ID: opts.phoneNumberId ?? "1445158248675072", SEED_DISPLAY_PHONE: "+971 50 939 7420", SEED_ACCESS_TOKEN: "EAA-secret-token" });
  const seed = seedTenantFromConfig(config);
  seed.tenant.slug = "asian-sports";
  seed.tenant.settings = { ...opts.settings };
  const demo = demoSportsCatalog(seed.tenant.id);
  return new SiteService(config, new InMemoryTenantRepository([seed]), new InMemoryCatalogRepository(demo.categories, demo.offerings), new InMemoryPropertyRepository());
}

const published = { site: { published: true, headline: "Play tonight", about: "Six courts in JLT." } };

describe("customer sites", () => {
  it("hides a page until it is published, and issues no certificate for it", async () => {
    const off = setup();
    expect(await off.publicSite("asian-sports")).toBeNull();
    expect(await off.allowsCertificate("asian-sports.ordr.ae")).toBe(false);

    const draft = setup({ settings: { site: { published: false, headline: "Soon" } } });
    expect(await draft.publicSite("asian-sports")).toBeNull();
  });

  it("issues certificates only for published sites on our domain", async () => {
    const on = setup({ settings: published });
    expect(await on.allowsCertificate("asian-sports.ordr.ae")).toBe(true);
    expect(await on.allowsCertificate("ASIAN-SPORTS.ordr.ae")).toBe(true);
    expect(await on.allowsCertificate("random.ordr.ae")).toBe(false);
    expect(await on.allowsCertificate("asian-sports.evil.com")).toBe(false);
    expect(await on.allowsCertificate("a.asian-sports.ordr.ae")).toBe(false);
    expect(await on.allowsCertificate("ordr.ae")).toBe(false);
  });

  it("shows the catalog, business details and a WhatsApp link", async () => {
    const site = (await setup({ settings: { ...published, facts: ["Free parking"], profile: { address: "JLT, Dubai", hours: "07:00-23:00" } } }).publicSite("asian-sports"))!;
    expect(site).toMatchObject({ name: "Asian Sports", vertical: "sports", headline: "Play tonight", about: "Six courts in JLT.", whatsapp: "971509397420", facts: ["Free parking"], profile: { address: "JLT, Dubai", hours: "07:00-23:00" } });
    expect(site.categories.map((c) => c.name)).toEqual(["Padel", "Tennis", "Football"]);
    expect(site.categories[0]!.items[0]).toMatchObject({ name: "Padel 60 min", price: "AED 200.00", durationMinutes: 60 });
  });

  it("speaks the requested language, and ignores an unknown one", async () => {
    const service = setup({ settings: published });
    expect((await service.publicSite("asian-sports", "ar"))!.categories[0]!.name).toBe("بادل");
    expect((await service.publicSite("asian-sports", "xx"))!.language).toBe("en");
  });

  it("never shows a placeholder number as a WhatsApp link", async () => {
    const site = await setup({ settings: published, phoneNumberId: "000000000000000" }).publicSite("asian-sports");
    expect(site!.whatsapp).toBeUndefined();
  });

  it("leaks nothing private", async () => {
    const site = await setup({ settings: { ...published, handoffNumbers: ["919840809031"] } }).publicSite("asian-sports");
    const json = JSON.stringify(site);
    expect(json).not.toContain("EAA-secret-token");
    expect(json).not.toContain("919840809031");
    expect(json).not.toContain("accessToken");
    expect(json).not.toContain("1445158248675072");
  });

  it("refuses slugs that could not be a subdomain", async () => {
    const service = setup({ settings: published });
    expect(await service.publicSite("../admin")).toBeNull();
    expect(await service.publicSite("-bad")).toBeNull();
  });
});
