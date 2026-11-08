import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import Stripe from "stripe";
import { admin, asFamily, facilityId, PASSWORD, userId } from "./helpers";
import { APP_URL, cookieFor } from "./app";
import { startFakeStripe, type StripeCall } from "./fake-stripe";

// Requires the app on APP_URL started with STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and
// STRIPE_API_BASE=http://127.0.0.1:4998 (npm run test:int does this).
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_kinline_integration";
const stripe = new Stripe("sk_test_unused");

let server: Server;
let calls: StripeCall[];
let originalSettings: Record<string, unknown>;
let demo: string;

beforeAll(async () => {
  ({ server, calls } = await startFakeStripe());
  demo = await facilityId();
  const { data } = await admin.from("facilities").select("settings").eq("id", demo).single();
  originalSettings = data!.settings;
  await admin.from("facilities").update({ settings: { ...originalSettings, message_fee_cents: 25, free_messages_per_week: 0 } }).eq("id", demo);
});
afterAll(async () => {
  await admin.from("facilities").update({ settings: originalSettings }).eq("id", demo);
  await new Promise((r) => server.close(r));
});

async function checkout(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${APP_URL}/api/payments/checkout`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function sendWebhook(event: object, sign = true) {
  const payload = JSON.stringify(event);
  const header = sign
    ? await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: WEBHOOK_SECRET })
    : await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_wrong" });
  const res = await fetch(`${APP_URL}/api/payments/webhook`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const completed = (id: string, user: string, facility: string, pi: string, amount = 1000) => ({
  id, object: "event", type: "checkout.session.completed", api_version: "2026-10-28.endive", created: Math.floor(Date.now() / 1000),
  data: { object: {
    id: `cs_test_${id}`, object: "checkout.session", mode: "payment", payment_status: "paid", currency: "usd",
    amount_total: amount, payment_intent: pi, metadata: { user_id: user, facility_id: facility, kind: "deposit" },
  } },
});

const balanceOf = async (user: string) => {
  const { data } = await admin.from("ledger_entries").select("amount_cents").eq("family_user_id", user);
  return (data ?? []).reduce((s, r) => s + r.amount_cents, 0);
};

describe("checkout route", () => {
  it("requires a signed-in family member", async () => {
    expect((await checkout({ amount_cents: 1000 })).status).toBe(401);
    expect((await checkout({ amount_cents: 1000 }, { authorization: "Bearer not-a-jwt" })).status).toBe(401);
    const staff = await cookieFor("staff@demo-county.test", PASSWORD);
    expect((await checkout({ amount_cents: 1000 }, { cookie: staff })).status).toBe(403);
  });

  it("only accepts the listed amounts", async () => {
    const fam = await cookieFor("family1@example.test", PASSWORD);
    expect((await checkout({ amount_cents: 1 }, { cookie: fam })).status).toBe(400);
    expect((await checkout({ amount_cents: 99999 }, { cookie: fam })).status).toBe(400);
  });

  it("creates a Checkout Session with the user, facility and an idempotency key (cookie)", async () => {
    const fam = await cookieFor("family1@example.test", PASSWORD);
    const before = calls.length;
    const res = await checkout({ amount_cents: 2500 }, { cookie: fam });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const call = calls[before];
    const user = await userId(await asFamily(1));
    expect(call.path).toBe("/v1/checkout/sessions");
    expect(call.auth).toBe(`Bearer ${process.env.STRIPE_SECRET_KEY ?? "sk_test_kinline_integration"}`);
    expect(call.form.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(call.form.get("metadata[user_id]")).toBe(user);
    expect(call.form.get("metadata[facility_id]")).toBe(demo);
    expect(call.form.get("payment_intent_data[metadata][user_id]")).toBe(user);
    expect(call.form.get("success_url")).toContain("/family/wallet?status=success");
    expect(call.idempotencyKey).toMatch(new RegExp(`^deposit:${user}:2500:`));
  });

  it("works for the app with a Bearer token and returns to the app", async () => {
    const c = await asFamily(2);
    const token = (await c.auth.getSession()).data.session!.access_token;
    const before = calls.length;
    const requestId = crypto.randomUUID();
    const res = await checkout({ amount_cents: 1000, return_to: "app", request_id: requestId }, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(calls[before].form.get("success_url")).toContain("/api/payments/app-return?status=success");
    expect(calls[before].idempotencyKey).toBe(`deposit:${await userId(c)}:1000:${requestId}`);
  });

  it("app return page hands off to the app deep link", async () => {
    const res = await fetch(`${APP_URL}/api/payments/app-return?status=success`, { redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("kinline://wallet?status=success");
  });
});

describe("webhook", () => {
  it("rejects missing and invalid signatures", async () => {
    const res = await fetch(`${APP_URL}/api/payments/webhook`, { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    const fam = await asFamily(3);
    const forged = await sendWebhook(completed(`evt_forged_${Date.now()}`, await userId(fam), demo, `pi_forged_${Date.now()}`), false);
    expect(forged.status).toBe(400);
    expect(await balanceOf(await userId(fam))).toBe(0);
  });

  it("credits once, even when replayed, then fees and refunds use the balance end to end", async () => {
    const fam = await asFamily(1);
    const user = await userId(fam);
    const start = await balanceOf(user);
    const n = Date.now();
    const pi = `pi_int_${n}`;

    const first = await sendWebhook(completed(`evt_dep_${n}`, user, demo, pi));
    expect(first.status).toBe(200);
    expect(first.body.result).toBe("credited");
    const replay = await sendWebhook(completed(`evt_dep_${n}`, user, demo, pi));
    expect(replay.body.result).toBe("duplicate");
    const otherEvent = await sendWebhook(completed(`evt_dep2_${n}`, user, demo, pi));
    expect(otherEvent.body.result).toBe("duplicate");
    expect(await balanceOf(user)).toBe(start + 1000);

    // the family reads the same balance over RLS
    const { data: mine } = await fam.rpc("my_balance");
    expect(Number(mine)).toBe(start + 1000);

    // a paid message is debited in the same transaction as the send
    const { data: contacts } = await fam.rpc("list_my_contacts");
    const { data: msgId, error } = await fam.rpc("send_message", { p_contact: contacts[0].contact_id, p_body: `paid ${n}` });
    expect(error).toBeNull();
    expect(await balanceOf(user)).toBe(start + 975);
    const { data: msg } = await admin.from("messages").select("fee_cents").eq("id", msgId).single();
    expect(msg!.fee_cents).toBe(25);

    // card refund (from the Stripe dashboard) removes funds once
    const refund = {
      id: `evt_re_${n}`, object: "event", type: "refund.created", api_version: "2026-10-28.endive", created: Math.floor(n / 1000),
      data: { object: { id: `re_int_${n}`, object: "refund", amount: 500, status: "succeeded", payment_intent: pi } },
    };
    expect((await sendWebhook(refund)).body.result).toBe("recorded");
    expect((await sendWebhook(refund)).body.result).toBe("duplicate");
    expect(await balanceOf(user)).toBe(start + 475);
  });

  it("ignores unpaid sessions and unrelated events", async () => {
    const fam = await asFamily(4);
    const user = await userId(fam);
    const n = Date.now();
    const unpaid = completed(`evt_unpaid_${n}`, user, demo, `pi_unpaid_${n}`);
    (unpaid.data.object as { payment_status: string }).payment_status = "unpaid";
    expect((await sendWebhook(unpaid)).body.result).toBe("ignored");
    expect((await sendWebhook({ id: `evt_other_${n}`, object: "event", type: "customer.created", data: { object: { id: "cus_1" } } })).body.result).toBe("ignored");
    expect(await balanceOf(user)).toBe(0);
  });

  it("insufficient balance blocks a paid message with a clear error", async () => {
    const fam = await asFamily(5);
    const { data: contacts } = await fam.rpc("list_my_contacts");
    expect(contacts?.length).toBeGreaterThan(0);
    const { error } = await fam.rpc("send_message", { p_contact: contacts[0].contact_id, p_body: "no funds" });
    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain("insufficient balance");
  });
});
