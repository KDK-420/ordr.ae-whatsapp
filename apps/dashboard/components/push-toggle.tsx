"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, isIos, isStandalone, type PushState, pushState } from "@/lib/push";

const EXPLAIN: Record<PushState, string> = {
  on: "This device gets a notification whenever the bot hands a chat to a person, even with the dashboard closed.",
  off: "Get a notification on this device whenever the bot hands a chat to a person, even with the dashboard closed.",
  denied: "Notifications are blocked for this site in the browser settings. Allow them there, then try again.",
  "server-off": "Push notifications are not set up on this server yet (WEB_PUSH keys).",
  "not-installed": "On iPhone and iPad, first add this dashboard to the home screen (Share › Add to Home Screen) and open it from there; Apple only delivers notifications to installed web apps.",
  unsupported: "This browser does not support push notifications.",
};

/** "Notify me on this device": registers the service worker and a Web Push subscription for the signed-in user. */
export function PushToggle() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      setState(state === "on" ? await disablePush() : await enablePush());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change notifications");
    } finally {
      setBusy(false);
    }
  }

  const on = state === "on";
  const canToggle = state === "on" || state === "off";
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Notify me on this device</h2>
          <p className="mt-2 text-sm text-slate-600">{state === "loading" ? "Checking this device…" : EXPLAIN[state]}</p>
          {state !== "loading" && isIos() && isStandalone() && state !== "on" ? <p className="mt-1 text-xs text-slate-500">Installed on the home screen: notifications will work once turned on.</p> : null}
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy || !canToggle}
          onClick={() => void toggle()}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-brand" : "bg-slate-300"}`}
          title={on ? "Turn off on this device" : "Turn on on this device"}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${on ? "left-[1.375rem]" : "left-0.5"}`} />
        </button>
      </div>
    </section>
  );
}
