/** Web Push registration for this browser or phone, against the merchant push endpoints. */

import { ApiError } from "@/lib/api";

export type PushState = "unsupported" | "not-installed" | "server-off" | "denied" | "off" | "on";

const SW_PATH = "/sw.js";

/** iPhones and iPads deliver Web Push only to a web app opened from the home screen. */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function toKeyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchPublicKey(): Promise<string | null> {
  const res = await fetch("/merchant/push/public-key", { credentials: "same-origin", cache: "no-store" });
  if (res.status === 503) return null;
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return ((await res.json()) as { publicKey: string }).publicKey;
}

/** Where this device stands: what the toggle shows before anyone taps it. */
export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? "not-installed" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if ((await fetchPublicKey()) === null) return "server-off";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Asks for permission, subscribes this browser with the server's key and stores the subscription. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIos() && !isStandalone() ? "not-installed" : "unsupported";
  const publicKey = await fetchPublicKey();
  if (!publicKey) return "server-off";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register(SW_PATH);
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKeyBytes(publicKey) }));
  const res = await fetch("/merchant/push/subscribe", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new ApiError(res.status, "Could not save this device");
  return "on";
}

/** Drops the subscription on the server and in the browser. */
export async function disablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/merchant/push/subscribe", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}
