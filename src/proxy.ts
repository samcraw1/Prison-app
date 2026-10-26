import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED: Record<string, string> = {
  "/family": "/family/login",
  "/resident": "/resident/login",
  "/staff": "/staff/login",
};
const PUBLIC = ["/family/login", "/family/signup", "/resident/login", "/staff/login"];

// Refreshes the Supabase session cookie and bounces signed-out visitors to the right login.
export async function proxy(request: NextRequest) {
  // Server components read the current path from this header (used for the resident PIN-change gate).
  const forwarded = new Headers(request.headers);
  forwarded.set("x-pathname", request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: forwarded } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: forwarded } });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const area = Object.keys(PROTECTED).find((p) => path === p || path.startsWith(p + "/"));
  if (area && !data.user && !PUBLIC.includes(path)) {
    return NextResponse.redirect(new URL(PROTECTED[area], request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|api/).*)"],
};
