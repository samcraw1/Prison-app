// Dev helper: prints a Cookie header for a signed-in user so pages can be curl'd. Usage: tsx scripts/cookie.ts email password
import { createServerClient } from "@supabase/ssr";

const jar = new Map<string, string>();
const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
  },
});
const [email, password] = process.argv.slice(2);
(async () => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  console.log([...jar].map(([n, v]) => `${n}=${v}`).join("; "));
})();
