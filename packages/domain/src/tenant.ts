import type { ChannelId, TenantId } from "./ids";

/** meta_cloud: a WhatsApp number; web: the tenant's web chat (one virtual channel per tenant). */
export type ChannelProvider = "meta_cloud" | "web";

export interface Tenant {
  id: TenantId;
  name: string;
  slug: string;
  /** Which vertical blueprint this tenant runs (e.g. "restaurant", "salon"). */
  blueprintId: string;
  defaultLanguage: string;
  timezone: string;
  settings: Record<string, unknown>;
}

export interface Channel {
  id: ChannelId;
  tenantId: TenantId;
  provider: ChannelProvider;
  /** Meta phone_number_id, the key every inbound webhook carries. */
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  accessToken: string;
  status: "active" | "disabled";
}

export interface Customer {
  id: string;
  tenantId: TenantId;
  /** WhatsApp id, i.e. the phone number in international format without "+". */
  waId: string;
  name?: string;
  language?: string;
}
