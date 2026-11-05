"use client";

import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { ApiError, type ConversationSettings, getConversationSettings, type SiteSettings, updateConversationSettings, uploadImage } from "@/lib/api";

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });

export default function WebsiteSettingsPage() {
  const [settings, setSettings] = useState<ConversationSettings | null>(null);
  const [site, setSite] = useState<SiteSettings>({ published: false });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConversationSettings()
      .then((s) => {
        setSettings(s);
        setSite(s.site ?? { published: false });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load settings"));
  }, []);

  async function pickHero(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await uploadImage(await readAsDataUrl(file));
      setSite((s) => ({ ...s, heroImageUrl: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that image");
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const s = await updateConversationSettings({ site: { published: site.published, headline: site.headline ?? "", about: site.about ?? "", heroImageUrl: site.heroImageUrl ?? "" } });
      setSettings(s);
      setSite(s.site);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? "Only owners can change the website." : err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold">Website</h1>
      <p className="mt-2 text-sm text-slate-600">A public page for your business, built from your catalog, prices, photos and business details. Customers book from it on WhatsApp or in the web chat.</p>

      <form onSubmit={save} className="mt-6 space-y-6">
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm has-[:checked]:border-brand">
          <input type="checkbox" checked={site.published} onChange={(e) => setSite({ ...site, published: e.target.checked })} className="mt-1" />
          <span>
            <span className="font-medium">Publish my page</span>
            <span className="block text-slate-600">While this is off, nobody can see the page.</span>
            {settings ? (
              <a href={settings.siteUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-brand underline">
                {settings.siteUrl}
              </a>
            ) : null}
          </span>
        </label>

        <label className="block text-sm font-medium">
          Headline
          <input value={site.headline ?? ""} onChange={(e) => setSite({ ...site, headline: e.target.value })} maxLength={120} placeholder="Leave empty for a standard headline" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-brand" />
        </label>

        <label className="block text-sm font-medium">
          About your business
          <textarea value={site.about ?? ""} onChange={(e) => setSite({ ...site, about: e.target.value })} rows={4} maxLength={1200} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-brand" />
        </label>

        <div className="text-sm">
          <span className="font-medium">Main photo</span>
          {site.heroImageUrl ? (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={site.heroImageUrl} alt="" className="h-20 w-32 rounded-md object-cover" />
              <button type="button" onClick={() => setSite({ ...site, heroImageUrl: "" })} className="text-xs text-slate-500 underline">
                Remove
              </button>
            </div>
          ) : null}
          <input type="file" accept="image/jpeg,image/png" onChange={(e) => void pickHero(e)} disabled={busy} className="mt-2 block text-sm" />
          <span className="mt-1 block text-xs text-slate-500">JPEG or PNG, up to 5 MB. Wide photos work best.</span>
        </div>

        <p className="text-xs text-slate-500">Address, phone and opening hours come from Settings › Conversation. Prices and photos come from your catalog.</p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {saved ? <p className="text-sm text-green-700">Saved.</p> : null}
        <button type="submit" disabled={busy || !settings} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
