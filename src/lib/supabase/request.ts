import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";

// Resolves the caller of a route handler. The web app sends its session cookie; the mobile app sends
// `Authorization: Bearer <access token>`. Either way the returned client acts as that user, so RLS and the
// security-definer functions apply exactly as they do for the web.
export async function getRequestAuth(req: Request): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const header = req.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header.trim());
    if (!match) return { supabase: anonClient(), user: null };
    const token = match[1];
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    // Verified by the Auth server (signature, expiry, revoked sessions), not just decoded.
    const { data, error } = await supabase.auth.getUser(token);
    return { supabase, user: error ? null : data.user };
  }
  const supabase = await createCookieClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

function anonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
