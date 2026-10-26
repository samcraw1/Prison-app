import { createServerClient } from "@supabase/ssr";

export const APP_URL = process.env.APP_URL ?? "http://localhost:3101";

// Signs in like the browser would and returns a Cookie header for calling the Next.js routes.
export async function cookieFor(email: string, password: string) {
  const jar = new Map<string, string>();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

export async function post(path: string, cookie?: string) {
  const res = await fetch(`${APP_URL}${path}`, { method: "POST", headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
