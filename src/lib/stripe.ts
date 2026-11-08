import "server-only";
import Stripe from "stripe";

// Server-side Stripe client. STRIPE_SECRET_KEY never leaves the server (not NEXT_PUBLIC_, not in the apps).
// Returns null when payments are not configured, so the rest of the app keeps working without Stripe.
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // STRIPE_API_BASE points the SDK at a fake server in integration tests. Never set it in production.
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  return new Stripe(key, {
    maxNetworkRetries: 2,
    ...(base ? { host: base.hostname, port: base.port, protocol: base.protocol === "http:" ? ("http" as const) : ("https" as const) } : {}),
  });
}

export function webhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}
