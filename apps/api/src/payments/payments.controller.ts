import { BadRequestException, Controller, Get, HttpCode, Inject, Logger, NotFoundException, Param, Post, type RawBodyRequest, Req } from "@nestjs/common";
import { formatMoney } from "@ordr/domain";
import type { Request } from "express";
import { CommerceService } from "../commerce/commerce.service";
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider, type PaymentProvider } from "./payment-provider";
import { TOKENS } from "../tokens";

/**
 * Payment webhooks and the public checkout status page data. The webhook is verified from the
 * raw body by the provider adapter; nothing in the body is trusted before that.
 */
@Controller("v1")
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
    @Inject(TOKENS.PaymentProvider) private readonly provider: PaymentProvider,
  ) {}

  @Post("webhooks/payments/:provider")
  @HttpCode(200)
  async webhook(@Param("provider") name: string, @Req() req: RawBodyRequest<Request>) {
    if (name !== this.provider.name) throw new NotFoundException("unknown payment provider");
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await this.commerce.handleWebhook(raw, req.headers as Record<string, string | string[] | undefined>);
    if (!result.accepted) {
      this.logger.warn(`rejected ${name} webhook: signature or body invalid`);
      throw new BadRequestException("invalid signature");
    }
    return { ok: true, applied: result.applied };
  }

  /** What the hosted checkout page shows: amount, items and state. No customer data beyond the order itself. */
  @Get("pay/:intent")
  async intent(@Param("intent") id: string) {
    const found = await this.commerce.intent(id);
    if (!found) throw new NotFoundException("unknown payment");
    const { intent, order } = found;
    return {
      id: intent.id,
      provider: intent.provider,
      status: intent.status,
      amount: formatMoney(intent.amountMinor, intent.currency),
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      expiresAt: intent.expiresAt,
      order: { number: order.number, status: order.status, items: order.items.map((i) => ({ title: i.title, variantTitle: i.variantTitle, quantity: i.quantity, lineTotal: formatMoney(i.lineTotalMinor, order.currency) })) },
      simulated: this.provider instanceof MockPaymentProvider,
    };
  }

  /**
   * Mock provider only: the "Pay" button on the checkout page. Produces the signed event a real
   * gateway would send and feeds it through the same verification and idempotency path.
   */
  @Post("pay/:intent/simulate")
  @HttpCode(200)
  async simulate(@Param("intent") id: string, @Req() req: Request) {
    if (!(this.provider instanceof MockPaymentProvider)) throw new NotFoundException("not available with this payment provider");
    const found = await this.commerce.intent(id);
    if (!found) throw new NotFoundException("unknown payment");
    const outcome = (req.body as { outcome?: unknown } | undefined)?.outcome === "fail" ? "failed" : "paid";
    const { body, signature } = this.provider.sign({ eventId: `evt_${id}_${outcome}`, intentId: id, status: outcome, amountMinor: found.intent.amountMinor });
    const result = await this.commerce.handleWebhook(body, { [MOCK_SIGNATURE_HEADER]: signature });
    return { ok: result.accepted, applied: result.applied, status: result.order?.status ?? found.order.status };
  }
}
