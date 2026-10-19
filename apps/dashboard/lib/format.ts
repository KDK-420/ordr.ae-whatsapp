export function money(minor: number, currency: string): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${currency} ${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** "just now", "4 min", "2 h", "3 d" */
export function age(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export const STATUS_LABEL: Record<string, string> = {
  placed: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
  requested: "Requested",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_progress: "In progress",
  no_show: "No show",
};

export const EVENT_LABEL: Record<string, string> = {
  accept: "Accept",
  reject: "Reject",
  cancel: "Cancel",
  start: "Start preparing",
  ready: "Mark ready",
  dispatch: "Out for delivery",
  deliver: "Delivered",
  complete: "Complete",
  confirm: "Confirm",
  check_in: "Check in",
  no_show: "No show",
};

/** Events that end an order; rendered as secondary buttons so they are harder to hit by accident. */
export const DESTRUCTIVE_EVENTS = new Set(["reject", "cancel", "no_show"]);

export const FULFILLMENT_LABEL: Record<string, string> = { delivery: "Delivery", pickup: "Pickup", dine_in: "Dine in", in_store: "In store", at_home: "At home" };

/** "Tue 20 Oct, 11:00" in the tenant's zone. */
export function when(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(at);
  return `${day}, ${timeOf(iso, timeZone)}`;
}

export function timeOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));
}

export const label = (map: Record<string, string>, key: string): string => map[key] ?? key.replace(/_/g, " ");

/** English first, then Arabic, then whatever the text has. */
export const localized = (t: Record<string, string> | null | undefined): string => t?.en || t?.ar || Object.values(t ?? {})[0] || "";
