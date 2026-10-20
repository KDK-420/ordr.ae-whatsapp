"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getPayment, type PaymentView, simulatePayment } from "@/lib/webchat";

/**
 * The hosted checkout page the assistant links to. With the mock provider it carries test
 * buttons; a real provider would redirect here only after its own payment page.
 */
export function Checkout({ intent }: { intent: string }) {
  const [view, setView] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await getPayment(intent));
    } catch (err) {
      setError(err instanceof Error ? err.message : "This payment link is not valid.");
    }
  }, [intent]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pay(outcome: "paid" | "fail") {
    setBusy(true);
    setError(null);
    try {
      await simulatePayment(intent, outcome);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
        <Link href="/" className="text-sm font-semibold text-slate-700">
          ordr<span className="text-brand">.ae</span> checkout
        </Link>
        {error && !view ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}
        {view ? (
          <>
            <h1 className="mt-4 text-xl font-semibold">Order #{view.order.number}</h1>
            <ul className="mt-4 divide-y divide-slate-100 text-sm">
              {view.order.items.map((i, n) => (
                <li key={`${i.title}-${n}`} className="flex justify-between py-2">
                  <span>
                    {i.quantity} × {i.title}
                    {i.variantTitle ? <span className="text-slate-500"> ({i.variantTitle})</span> : null}
                  </span>
                  <span>{i.lineTotal}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex justify-between text-base font-semibold">
              <span>Total (incl. VAT)</span>
              <span>{view.amount}</span>
            </p>
            {view.status === "paid" ? (
              <p className="mt-6 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">Paid. Thank you! Your order is confirmed; you can return to the chat.</p>
            ) : view.status === "pending" ? (
              <div className="mt-6">
                {view.simulated ? (
                  <>
                    <p className="text-xs text-slate-500">Test mode: no card is charged. This button produces the same signed confirmation a payment provider would send.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => pay("paid")} disabled={busy} className="flex-1 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                        Pay {view.amount}
                      </button>
                      <button type="button" onClick={() => pay("fail")} disabled={busy} className="rounded-md border border-slate-300 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        Simulate failure
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">Waiting for the payment provider…</p>
                )}
                <p className="mt-3 text-xs text-slate-400">Link valid until {new Date(view.expiresAt).toLocaleString()}</p>
              </div>
            ) : (
              <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{view.status === "failed" ? "The payment did not go through. Go back to the chat to try again." : "This payment link has expired. Ask the assistant for a new one."}</p>
            )}
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          </>
        ) : !error ? (
          <p className="mt-6 text-sm text-slate-500">Loading…</p>
        ) : null}
      </div>
    </main>
  );
}
