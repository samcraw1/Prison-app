import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getVideoProvider } from "@/lib/video/daily";

// Staff-only: kick everyone out of the room, then record who ended it.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("role").eq("id", auth.user.id).single();
  if (!me || !["staff", "admin"].includes(me.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const { data: visit } = await supabase.from("visits").select("id, status, daily_room").eq("id", id.data).maybeSingle();
  if (!visit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (visit.status !== "live") return NextResponse.json({ error: "This visit is not live." }, { status: 409 });

  const provider = getVideoProvider();
  if (provider && visit.daily_room) {
    try {
      await provider.deleteRoom(visit.daily_room);
    } catch (e) {
      console.error("could not delete room", e);
      return NextResponse.json({ error: "Could not end the call. Try again." }, { status: 502 });
    }
  }
  const { error } = await supabase.rpc("end_visit", { p_visit: visit.id });
  if (error) return NextResponse.json({ error: "Could not record the end of the visit." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
