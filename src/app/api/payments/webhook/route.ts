import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, webhookSecret } from "@/lib/stripe";

// Stripe -> ledger. The signature is verified against the raw body before anything is read. Ledger writes go
// through service-role database functions that are idempotent on the Stripe event id and object ids, so Stripe's
// retries and replays credit or debit at most once.
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = webhookSecret();
  if (!stripe || !secret) return NextResponse.json({ error: "Payments are not configured" }, { status: 503 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await handle(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // 500 makes Stripe retry later; handlers are idempotent.
    console.error("stripe webhook failed", event.type, event.id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

async function handle(event: Stripe.Event): Promise<string> {
  const admin = createAdminClient();
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as string;
  };

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      // Delayed payment methods complete later (async_payment_succeeded); only paid sessions add funds.
      if (s.payment_status !== "paid" || s.mode !== "payment" || s.metadata?.kind !== "deposit") return "ignored";
      const pi = idOf(s.payment_intent);
      if (!pi || !s.metadata.user_id || !s.metadata.facility_id || !s.amount_total) throw new Error("incomplete session");
      return rpc("record_deposit", {
        p_user: s.metadata.user_id, p_facility: s.metadata.facility_id, p_amount: s.amount_total,
        p_currency: s.currency, p_payment_intent: pi, p_event: event.id,
      });
    }
    case "refund.created":
    case "refund.failed": {
      const r = event.data.object;
      const pi = idOf(r.payment_intent);
      if (!pi) return "ignored";
      // A refund that later fails puts the money back (refund.failed); canceled refunds never moved money.
      if (event.type === "refund.created" && r.status === "canceled") return "ignored";
      return rpc("record_stripe_reversal", {
        p_payment_intent: pi, p_kind: event.type === "refund.failed" ? "refund_failed" : "refund",
        p_object_id: r.id, p_amount: r.amount, p_event: event.id,
      });
    }
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated": {
      const d = event.data.object;
      const pi = idOf(d.payment_intent);
      if (!pi) return "ignored";
      return rpc("record_stripe_reversal", {
        p_payment_intent: pi, p_kind: event.type === "charge.dispute.funds_withdrawn" ? "dispute_withdrawn" : "dispute_reinstated",
        p_object_id: d.id, p_amount: d.amount, p_event: event.id,
      });
    }
    default:
      return "ignored";
  }
}
