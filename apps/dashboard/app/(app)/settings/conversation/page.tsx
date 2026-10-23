"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, type BusinessProfile, type ConversationSettings, getConversationSettings, updateConversationSettings } from "@/lib/api";

export default function ConversationSettingsPage() {
  const [settings, setSettings] = useState<ConversationSettings | null>(null);
  const [style, setStyle] = useState<"guided" | "natural">("guided");
  const [facts, setFacts] = useState("");
  const [profile, setProfile] = useState<BusinessProfile>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getConversationSettings();
      setSettings(s);
      setStyle(s.conversationStyle);
      setFacts(s.facts.join("\n"));
      setProfile(s.profile ?? {});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await updateConversationSettings({
        conversationStyle: style,
        facts: facts.split("\n").map((f) => f.trim()).filter(Boolean),
        profile: { address: profile.address ?? "", mapsUrl: profile.mapsUrl ?? "", phone: profile.phone ?? "", hours: profile.hours ?? "" },
      });
      setSettings(s);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "Only owners can change these settings." : err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Conversation</h1>
      <p className="mt-2 text-sm text-slate-600">How the bot talks to customers on WhatsApp, and what it is allowed to tell them.</p>

      <form onSubmit={save} className="mt-6 space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Style</legend>
          <label className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm has-[:checked]:border-brand">
            <input type="radio" name="style" value="natural" checked={style === "natural"} onChange={() => setStyle("natural")} className="mt-1" />
            <span>
              <span className="font-medium">Natural</span>
              <span className="block text-slate-600">Claude chats like a member of your team: understands plain sentences, offers times, books, cancels and hands over to you when needed. Prices, times and bookings always come from your real data.</span>
              {settings && !settings.assistantAvailable ? <span className="mt-1 block text-xs text-amber-700">The AI key is not configured on the server, so this runs as Guided until it is.</span> : null}
            </span>
          </label>
          <label className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm has-[:checked]:border-brand">
            <input type="radio" name="style" value="guided" checked={style === "guided"} onChange={() => setStyle("guided")} className="mt-1" />
            <span>
              <span className="font-medium">Guided</span>
              <span className="block text-slate-600">Menus, buttons and lists in a fixed order. Predictable and works without the AI.</span>
            </span>
          </label>
          {settings ? <p className="text-xs text-slate-500">Default for your type of business: {settings.defaultStyle}.</p> : null}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Business details</legend>
          <p className="text-xs text-slate-500">The bot gives these when customers ask where you are, how to call or when you open, and adds the address and map link to every booking confirmation and reminder.</p>
          <label className="block text-sm">
            Address
            <input value={profile.address ?? ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} placeholder="Indigo Tower, Cluster D, JLT, Dubai, shop 4" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
          </label>
          <label className="block text-sm">
            Map link
            <input value={profile.mapsUrl ?? ""} onChange={(e) => setProfile({ ...profile, mapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" inputMode="url" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Phone
              <input value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="+971 4 000 0000" inputMode="tel" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
            <label className="block text-sm">
              Opening hours
              <input value={profile.hours ?? ""} onChange={(e) => setProfile({ ...profile, hours: e.target.value })} placeholder="Sat–Thu 10:00–21:00, Fri 14:00–22:00" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
            </label>
          </div>
        </fieldset>

        <label className="block text-sm font-medium">
          Facts the bot may share
          <textarea value={facts} onChange={(e) => setFacts(e.target.value)} rows={6} placeholder={"One per line, e.g.\nFree parking in the building.\nWalk-ins welcome before 2pm.\nCancellations under 2 hours are charged 50%."} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand" />
          <span className="mt-1 block text-xs font-normal text-slate-500">Parking, policies, anything else customers ask. The bot never invents facts that are not here, in the details above, or in your catalog.</span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {saved ? <p className="text-sm text-green-700">Saved. Applies to the next message.</p> : null}
        <button type="submit" disabled={busy || !settings} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
