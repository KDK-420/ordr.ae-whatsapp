import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { conversationStyle } from "../ai/agent";
import { AssistantService } from "../ai/assistant.service";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { DEFAULT_HANDOFF_RESUME_MINUTES, handoffResumeMinutes } from "../conversation/conversation.service";
import { handoffNumbers, MAX_HANDOFF_NUMBERS } from "../conversation/handoff-notifier";
import type { BlueprintRegistry, TenantRepository } from "../ports";
import { businessProfile } from "../tenant-profile";
import { TOKENS } from "../tokens";

const optionalText = (max: number) => z.string().trim().max(max).optional();

const PatchSchema = z.object({
  conversationStyle: z.enum(["guided", "natural"]).optional(),
  /** Short facts the assistant may share: parking, policies, anything else customers ask. */
  facts: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  /** Where the branch is and how to reach it; shared by the agent and added to confirmations. Empty strings clear a field. */
  profile: z
    .object({
      address: optionalText(300),
      mapsUrl: z.union([z.string().trim().url().max(500), z.literal("")]).optional(),
      phone: optionalText(40),
      hours: optionalText(300),
    })
    .optional(),
  /** Staff WhatsApp numbers (E.164 digits, "+" and spaces tolerated) alerted when the bot hands a thread over. An empty list clears them. */
  handoffNumbers: z.array(z.string().trim().regex(/^\+?[\d\s-]{8,20}$/, "must be a phone number in international format")).max(MAX_HANDOFF_NUMBERS).optional(),
  /** Minutes a handed-over chat may wait for a person before the bot answers again; 0 keeps it waiting. */
  handoffResumeMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
});

/** Tenant-level settings an owner can change: how the bot talks and what it knows. */
@Controller("merchant/settings")
@UseGuards(AuthGuard)
export class MerchantSettingsController {
  constructor(
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(AssistantService) private readonly assistant: AssistantService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return this.view(user.tenantId);
  }

  @Patch()
  async patch(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (user.role !== "owner") throw new ForbiddenException("only owners can change settings");
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const patch: Record<string, unknown> = {};
    if (parsed.data.conversationStyle) patch.conversationStyle = parsed.data.conversationStyle;
    if (parsed.data.facts) patch.facts = parsed.data.facts;
    if (parsed.data.profile) patch.profile = businessProfile({ profile: parsed.data.profile });
    if (parsed.data.handoffNumbers) patch.handoffNumbers = handoffNumbers({ handoffNumbers: parsed.data.handoffNumbers });
    if (parsed.data.handoffResumeMinutes !== undefined) patch.handoffResumeMinutes = parsed.data.handoffResumeMinutes;
    if (!(await this.tenants.updateSettings(user.tenantId, patch))) throw new NotFoundException("tenant not found");
    return this.view(user.tenantId);
  }

  private async view(tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException("tenant not found");
    const blueprint = this.blueprints.get(tenant.blueprintId);
    const facts = Array.isArray(tenant.settings.facts) ? (tenant.settings.facts as unknown[]).filter((f): f is string => typeof f === "string") : [];
    return {
      conversationStyle: blueprint ? conversationStyle(tenant, blueprint) : "guided",
      /** What the vertical uses when the tenant has not chosen. */
      defaultStyle: blueprint && (blueprint.settings as Record<string, unknown>).conversationStyle === "natural" ? "natural" : "guided",
      facts,
      profile: businessProfile(tenant.settings),
      handoffNumbers: handoffNumbers(tenant.settings),
      handoffResumeMinutes: handoffResumeMinutes(tenant.settings),
      defaultHandoffResumeMinutes: DEFAULT_HANDOFF_RESUME_MINUTES,
      /** Natural style needs the model; without the key it silently runs guided. */
      assistantAvailable: this.assistant.conversational,
    };
  }
}
