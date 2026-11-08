import { NextResponse } from "next/server";
import { z } from "zod";
import { DEPOSIT_AMOUNTS_CENTS } from "@shared/payments";
import { getRequestAuth } from "@/lib/supabase/request";
import { getStripe } from "@/lib/stripe";

const bodySchema = z.object({
  amount_cents: z.number().int().refine((a) => (DEPOSIT_AMOUNTS_CENTS as readonly number[]).includes(a)),
  // "app": the mobile app opened this in the system browser and wants to be sent back to kinline://wallet.
  return_to: z.enum(["web", "app"]).default("web"),
  // Lets a client retry the same request without creating a second Checkout Session.
  request_id: z.string().uuid().optional(),
});

// Creates a Stripe Checkout Session for adding funds. Card details are entered on Stripe's page only; the balance
// is credited by the webhook (never here), after Stripe confirms payment.
export async function POST(req: Request) {
  const { supabase, user } = await getRequestAuth(req);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("id, role, status, facility_id").eq("id", user.id).single();
  if (!me || me.status !== "active") return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (me.role !== "family") return NextResponse.json({ error: "Only family accounts can add funds" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose one of the listed amounts" }, { status: 400 });
  const { amount_cents, return_to, request_id } = parsed.data;

  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Adding funds is not available yet" }, { status: 503 });

  const origin = (process.env.PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const back = (status: "success" | "cancelled") =>
    return_to === "app" ? `${origin}/api/payments/app-return?status=${status}` : `${origin}/family/wallet?status=${status}`;
  const metadata = { user_id: me.id, facility_id: me.facility_id, kind: "deposit" };

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount_cents, product_data: { name: "Kinline balance" } } }],
        client_reference_id: me.id,
        metadata,
        // Refunds and disputes arrive on the PaymentIntent/charge; the ledger finds the deposit by its id.
        payment_intent_data: { metadata },
        success_url: back("success"),
        cancel_url: back("cancelled"),
      },
      { idempotencyKey: `deposit:${me.id}:${amount_cents}:${request_id ?? crypto.randomUUID()}` },
    );
    if (!session.url) throw new Error("no checkout url");
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("checkout session failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
