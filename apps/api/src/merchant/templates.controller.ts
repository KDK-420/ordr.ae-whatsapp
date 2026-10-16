import { BadGatewayException, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentUser } from "../auth/auth.guard";
import type { AuthUser } from "../auth/auth.service";
import { OrderService } from "../orders/order.service";
import type { BlueprintRegistry } from "../ports";
import { DEFAULT_TEMPLATES, TemplateError, TemplateService } from "../templates/template.service";
import { TOKENS } from "../tokens";

@Controller("merchant/templates")
@UseGuards(AuthGuard)
export class MerchantTemplatesController {
  constructor(
    @Inject(TemplateService) private readonly templates: TemplateService,
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const languages = await this.languages(user.tenantId);
    return { templates: await this.templates.list(user.tenantId), defaults: DEFAULT_TEMPLATES.map((d) => ({ purpose: d.purpose, name: d.name, bodies: d.bodies })), languages };
  }

  /** Submits the default templates to Meta for review in each of the tenant's languages. */
  @Post("submit")
  @HttpCode(200)
  async submit(@CurrentUser() user: AuthUser) {
    try {
      const languages = await this.languages(user.tenantId);
      await this.templates.submitDefaults(user.tenantId, languages);
      return { templates: await this.templates.list(user.tenantId) };
    } catch (err) {
      if (err instanceof TemplateError) throw new BadGatewayException(err.message);
      throw err;
    }
  }

  @Post("sync")
  @HttpCode(200)
  async sync(@CurrentUser() user: AuthUser) {
    try {
      return { templates: await this.templates.sync(user.tenantId) };
    } catch (err) {
      if (err instanceof TemplateError) throw new BadGatewayException(err.message);
      throw new BadGatewayException(`Meta did not answer: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async languages(tenantId: string): Promise<string[]> {
    const settings = await this.orders.settingsFor(tenantId);
    return this.blueprints.get(settings.tenant.blueprintId)?.languages ?? [settings.tenant.defaultLanguage];
  }
}
