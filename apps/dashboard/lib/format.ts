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
};

/** Events that end an order; rendered as secondary buttons so they are harder to hit by accident. */
export const DESTRUCTIVE_EVENTS = new Set(["reject", "cancel"]);

export const FULFILLMENT_LABEL: Record<string, string> = { delivery: "Delivery", pickup: "Pickup", dine_in: "Dine in" };

export const label = (map: Record<string, string>, key: string): string => map[key] ?? key.replace(/_/g, " ");
