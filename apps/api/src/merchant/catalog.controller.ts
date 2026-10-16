import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import type { CatalogRepository } from "../ports";
import { TOKENS } from "../tokens";

/** { en: "Burgers", ar: "برجر" }: at least one language with text. */
const LocalizedText = z
  .record(z.string().min(2).max(8), z.string().trim().max(200))
  .transform((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0)))
  .refine((t) => Object.keys(t).length > 0, "at least one language is required");

const OptionalText = z
  .record(z.string().min(2).max(8), z.string().trim().max(1000))
  .transform((t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v.length > 0)))
  .transform((t) => (Object.keys(t).length ? t : null))
  .nullable();

const Minor = z.number().int().min(0).max(100_000_000);

const CategorySchema = z.object({ name: LocalizedText, sortOrder: z.number().int().min(0).optional(), isActive: z.boolean().optional() });

const OptionSchema = z.object({ name: LocalizedText, priceDeltaMinor: z.number().int().min(-100_000_000).max(100_000_000).default(0), sortOrder: z.number().int().min(0).optional(), isActive: z.boolean().optional() });
const GroupSchema = z
  .object({ name: LocalizedText, minSelect: z.number().int().min(0).default(0), maxSelect: z.number().int().min(1).default(1), sortOrder: z.number().int().min(0).optional(), options: z.array(OptionSchema).min(1).max(50) })
  .refine((g) => g.minSelect <= g.maxSelect, "minSelect cannot exceed maxSelect");

const OfferingSchema = z.object({
  categoryId: z.string().min(1).nullable().optional(),
  type: z.enum(["product", "service"]).optional(),
  name: LocalizedText,
  description: OptionalText.optional(),
  priceMinor: Minor,
  currency: z.string().length(3).optional(),
  durationMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  modifierGroups: z.array(GroupSchema).max(20).optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw new BadRequestException(res.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return res.data;
}

@Controller("merchant/catalog")
@UseGuards(AuthGuard)
export class MerchantCatalogController {
  constructor(@Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository) {}

  @Get()
  async all(@CurrentUser() user: AuthUser) {
    const [categories, offerings] = await Promise.all([this.catalog.listAllCategories(user.tenantId), this.catalog.listAllOfferings(user.tenantId)]);
    return { categories, offerings };
  }

  @Post("categories")
  createCategory(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.catalog.createCategory(user.tenantId, parse(CategorySchema, body));
  }

  @Patch("categories/:id")
  async updateCategory(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const updated = await this.catalog.updateCategory(user.tenantId, id, parse(CategorySchema.partial(), body));
    if (!updated) throw new NotFoundException("category not found");
    return updated;
  }

  @Post("offerings")
  async createOffering(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(OfferingSchema, body);
    await this.assertCategory(user.tenantId, input.categoryId);
    return this.catalog.createOffering(user.tenantId, input);
  }

  @Patch("offerings/:id")
  async updateOffering(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const patch = parse(OfferingSchema.partial(), body);
    await this.assertCategory(user.tenantId, patch.categoryId);
    const updated = await this.catalog.updateOffering(user.tenantId, id, patch);
    if (!updated) throw new NotFoundException("offering not found");
    return updated;
  }

  private async assertCategory(tenantId: string, categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    const categories = await this.catalog.listAllCategories(tenantId);
    if (!categories.some((c) => c.id === categoryId)) throw new BadRequestException("categoryId does not belong to this tenant");
  }
}
