"use client";

import { useCallback, useEffect, useState } from "react";
import { listTemplates, type MessageTemplate, submitTemplates, syncTemplates, type TemplateList } from "@/lib/api";

const STATUS_STYLE: Record<MessageTemplate["status"], string> = {
  approved: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-800",
  draft: "bg-slate-100 text-slate-700",
  paused: "bg-amber-100 text-amber-800",
  disabled: "bg-slate-200 text-slate-600",
};

export default function TemplatesPage() {
  const [data, setData] = useState<TemplateList | null>(null);
  const [busy, setBusy] = useState<"submit" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listTemplates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load templates");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(kind: "submit" | "sync") {
    setBusy(kind);
    setError(null);
    try {
      await (kind === "submit" ? submitTemplates() : syncTemplates());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const templates = data?.templates ?? [];
  const missing = data ? data.languages.filter((l) => !templates.some((t) => t.language === l)) : [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">WhatsApp templates</h1>
      <p className="mt-2 text-sm text-slate-600">
        WhatsApp lets a business message a customer freely for 24 hours after the customer's last message. After that only
        templates approved by Meta may be sent. The order status template below keeps customers informed either way. Meta
        usually reviews templates within minutes, sometimes up to a day.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("submit")}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy === "submit" ? "Submitting…" : missing.length ? "Submit templates for review" : "Resubmit missing or rejected"}
        </button>
        <button
          type="button"
          disabled={busy !== null || templates.length === 0}
          onClick={() => run("sync")}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:border-slate-400 disabled:opacity-50"
        >
          {busy === "sync" ? "Checking…" : "Check review status"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Template</th>
              <th className="px-4 py-2">Language</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Body</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {templates.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  {data ? "No templates submitted yet." : "Loading…"}
                </td>
              </tr>
            ) : null}
            {templates.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3">{t.language}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                  {t.rejectedReason ? <div className="mt-1 text-xs text-red-600">{t.rejectedReason}</div> : null}
                </td>
                <td className="px-4 py-3 text-slate-600" dir="auto">
                  {t.body}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && missing.length ? (
        <p className="mt-3 text-xs text-slate-500">Not submitted yet for: {missing.join(", ")}.</p>
      ) : null}
    </div>
  );
}
