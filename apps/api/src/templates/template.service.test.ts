import { describe, expect, it } from "vitest";
import { InMemoryTenantRepository } from "../adapters/memory";
import { FakeTemplateApi, InMemoryTemplateRepository } from "../adapters/templates";
import { seedTenantFromConfig } from "../app.module";
import { loadConfig } from "../config";
import { TemplateService } from "./template.service";

function setup() {
  const config = loadConfig({ META_APP_SECRET: "s", META_VERIFY_TOKEN: "v", STORAGE: "memory" });
  const seed = seedTenantFromConfig(config);
  const repo = new InMemoryTemplateRepository();
  const api = new FakeTemplateApi();
  const service = new TemplateService(repo, api, new InMemoryTenantRepository([seed]));
  return { service, repo, api, tenantId: seed.tenant.id, wabaId: seed.channel.wabaId };
}

describe("TemplateService", () => {
  it("submits the default templates once per language and records Meta's answer", async () => {
    const { service, api, tenantId, wabaId } = setup();
    api.statusForNew = "PENDING";
    const first = await service.submitDefaults(tenantId, ["en", "ar", "fr"]);
    expect(first.map((t) => `${t.name}/${t.language}:${t.status}`)).toEqual(["ordr_order_status/en:pending", "ordr_order_status/ar:pending"]);
    expect(api.created.map((c) => c.wabaId)).toEqual([wabaId, wabaId]);
    expect(api.created[0]!.definition.body).toContain("{{1}}");

    // Submitting again does not resubmit templates already under review.
    await service.submitDefaults(tenantId, ["en", "ar"]);
    expect(api.created).toHaveLength(2);
  });

  it("syncs review statuses from Meta and then serves approved templates with fallbacks", async () => {
    const { service, api, tenantId } = setup();
    api.statusForNew = "PENDING";
    await service.submitDefaults(tenantId, ["en"]);
    expect(await service.approved(tenantId, "order_status", "en")).toBeNull();

    api.statusForNew = "APPROVED";
    const synced = await service.sync(tenantId);
    expect(synced[0]).toMatchObject({ status: "approved", metaId: "fake_1" });

    expect(await service.approved(tenantId, "order_status", "ar", ["en"])).toMatchObject({ language: "en" });
    expect(await service.approved(tenantId, "order_status", "ar")).toBeNull();
  });

  it("marks a template rejected when Meta refuses the submission", async () => {
    const { service, api, repo, tenantId } = setup();
    api.createTemplate = async () => {
      throw new Error("(#100) Invalid parameter");
    };
    await service.submitDefaults(tenantId, ["en"]);
    expect(repo.rows[0]).toMatchObject({ status: "rejected", rejectedReason: "(#100) Invalid parameter" });
  });

  it("renders positional parameters in the declared order", async () => {
    const { service, tenantId } = setup();
    await service.submitDefaults(tenantId, ["ar"]);
    const t = (await service.approved(tenantId, "order_status", "ar"))!;
    const message = service.render(t, { orderNumber: 7, status: "جاهز", total: "AED 12.00" });
    expect(message).toEqual({
      type: "template",
      template: {
        name: "ordr_order_status",
        language: { code: "ar" },
        components: [{ type: "body", parameters: [{ type: "text", text: "7" }, { type: "text", text: "جاهز" }, { type: "text", text: "AED 12.00" }] }],
      },
    });
  });
});
