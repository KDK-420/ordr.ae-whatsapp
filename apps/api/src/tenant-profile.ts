/**
 * The business details a merchant publishes to customers: where the branch is, how to call,
 * when it opens. Stored in `tenant.settings.profile`, edited in Settings › Conversation, read by
 * the agent's prompt and appended to booking confirmations and reminders.
 */
export interface BusinessProfile {
  /** Street address as customers should read it, e.g. "JLT, Cluster D, Indigo Tower, shop 4". */
  address?: string;
  /** A Google Maps (or similar) link customers can tap. */
  mapsUrl?: string;
  /** Phone number customers may call, in international format. */
  phone?: string;
  /** Opening hours in words, e.g. "Sat–Thu 10:00–21:00, Fri 14:00–22:00". */
  hours?: string;
}

const KEYS = ["address", "mapsUrl", "phone", "hours"] as const;

export function businessProfile(settings: Record<string, unknown>): BusinessProfile {
  const raw = settings.profile;
  if (!raw || typeof raw !== "object") return {};
  const out: BusinessProfile = {};
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

/** Lines to append under a confirmation or reminder: address, map link. Empty when the merchant has not filled them in. */
export function locationLines(profile: BusinessProfile): string[] {
  const lines: string[] = [];
  if (profile.address) lines.push(`📍 ${profile.address}`);
  if (profile.mapsUrl) lines.push(profile.mapsUrl);
  return lines;
}

/** The same details as prompt lines for the agent, labelled so the model knows what each one is. */
export function profilePromptLines(profile: BusinessProfile): string[] {
  const lines: string[] = [];
  if (profile.address) lines.push(`- Address: ${profile.address}`);
  if (profile.mapsUrl) lines.push(`- Map link: ${profile.mapsUrl}`);
  if (profile.phone) lines.push(`- Phone: ${profile.phone}`);
  if (profile.hours) lines.push(`- Opening hours: ${profile.hours}`);
  return lines;
}
