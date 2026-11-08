// Drains public.push_outbox and delivers through the Expo Push Service (APNs + FCM).
// Invoke from a Database Webhook on push_outbox INSERT, or a pg_cron schedule, with header
// `x-dispatch-secret: $PUSH_DISPATCH_SECRET`. The anon key alone cannot trigger it.
import { createClient } from "npm:@supabase/supabase-js@2";

const EXPO_URL = "https://exp.host/--/api/v2/push/send";

Deno.serve(async (req) => {
  const secret = Deno.env.get("PUSH_DISPATCH_SECRET");
  if (!secret || req.headers.get("x-dispatch-secret") !== secret) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: batch, error } = await admin.rpc("claim_push_batch", { p_limit: 100 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!batch?.length) return Response.json({ sent: 0 });

  const userIds = [...new Set(batch.map((b: { user_id: string }) => b.user_id))];
  const { data: tokens } = await admin.from("push_tokens").select("token, user_id").in("user_id", userIds);

  const messages: { to: string; title: string; body: string; data: unknown; sound: string; outboxId: number }[] = [];
  for (const item of batch) {
    for (const t of tokens ?? []) {
      if (t.user_id === item.user_id) {
        messages.push({ to: t.token, title: item.title, body: item.body, data: item.data, sound: "default", outboxId: item.id });
      }
    }
  }

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  const expoToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (expoToken) headers.authorization = `Bearer ${expoToken}`;

  const failed = new Map<number, string>();
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(chunk.map(({ outboxId: _id, ...m }) => m)),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(`expo ${res.status}`);
      const tickets: { status: string; details?: { error?: string } }[] = json.data ?? [];
      for (const [j, ticket] of tickets.entries()) {
        if (ticket.status !== "error") continue;
        if (ticket.details?.error === "DeviceNotRegistered") {
          await admin.from("push_tokens").delete().eq("token", chunk[j].to);
        } else {
          failed.set(chunk[j].outboxId, ticket.details?.error ?? "error");
        }
      }
    } catch (e) {
      chunk.forEach((m) => failed.set(m.outboxId, String(e)));
    }
  }

  const ok = batch.map((b: { id: number }) => b.id).filter((id: number) => !failed.has(id));
  if (ok.length) await admin.from("push_outbox").update({ sent_at: new Date().toISOString(), last_error: null }).in("id", ok);
  for (const [id, err] of failed) await admin.from("push_outbox").update({ last_error: err.slice(0, 300) }).eq("id", id);

  return Response.json({ sent: ok.length, failed: failed.size });
});
