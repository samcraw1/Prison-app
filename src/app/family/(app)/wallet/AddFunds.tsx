"use client";

import { useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { DEPOSIT_AMOUNTS_CENTS, formatCents } from "@shared/payments";

// Sends the browser to Stripe Checkout. Card details are entered on Stripe's page, never on ClearLine.
export function AddFunds() {
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState<string>();

  async function start(amount: number) {
    setBusy(amount);
    setError(undefined);
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_cents: amount, request_id: crypto.randomUUID() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error ?? "Could not start checkout. Please try again.");
      window.location.assign(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout. Please try again.");
      setBusy(undefined);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Add funds</p>
      <div className="flex flex-wrap gap-3">
        {DEPOSIT_AMOUNTS_CENTS.map((a) => (
          <Button key={a} variant="secondary" disabled={busy !== undefined} onClick={() => start(a)}>
            {busy === a ? "Opening…" : formatCents(a)}
          </Button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      <p className="text-xs text-slate-500">Payments are processed by Stripe. ClearLine never sees your card number.</p>
    </div>
  );
}
