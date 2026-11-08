import { createServer, type Server } from "node:http";

export type StripeCall = { method: string; path: string; form: URLSearchParams; idempotencyKey?: string; auth?: string };

// Minimal stand-in for the Stripe API (Checkout Sessions only), so the checkout route can be tested without a key.
// The app is pointed here with STRIPE_API_BASE (npm run test:int sets it).
export function startFakeStripe(port = 4998): Promise<{ server: Server; calls: StripeCall[] }> {
  const calls: StripeCall[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const form = new URLSearchParams(raw);
      calls.push({
        method: req.method!, path: req.url!, form,
        idempotencyKey: req.headers["idempotency-key"] as string | undefined,
        auth: req.headers.authorization,
      });
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
        const id = `cs_test_${calls.length}`;
        return res.end(JSON.stringify({ id, object: "checkout.session", url: `https://checkout.stripe.test/pay/${id}`, metadata: {} }));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: "not found", type: "invalid_request_error" } }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, calls })));
}
