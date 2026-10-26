import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const next = new URL(request.url).searchParams.get("next");
  const target = next && /^\/(family|resident|staff)\/login$/.test(next) ? next : "/";
  return NextResponse.redirect(new URL(target, request.url), 303);
}
