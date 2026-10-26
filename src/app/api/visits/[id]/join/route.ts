import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVideoProvider } from "@/lib/video/daily";

const EARLY_JOIN_MS = 5 * 60_000;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("id, role, full_name, facility_id").eq("id", auth.user.id).single();
  if (!me) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  await supabase.rpc("expire_visits");

  // RLS decides whether this person may see the visit at all.
  const { data: visit } = await supabase
    .from("visits")
    .select("id, status, facility_id, contact_id, visit_slots(starts_at, ends_at), contacts(resident_id)")
    .eq("id", id.data)
    .maybeSingle();
  if (!visit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const slot = Array.isArray(visit.visit_slots) ? visit.visit_slots[0] : visit.visit_slots;
  const contact = Array.isArray(visit.contacts) ? visit.contacts[0] : visit.contacts;
  if (!slot || !contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isStaff = me.role === "staff" || me.role === "admin";
  if (!["family", "resident", "staff", "admin"].includes(me.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const now = Date.now();
  const starts = new Date(slot.starts_at).getTime();
  const ends = new Date(slot.ends_at).getTime();
  if (isStaff ? visit.status !== "live" : !["approved", "live"].includes(visit.status)) {
    return NextResponse.json({ error: isStaff ? "This visit is not live." : "This visit is not ready to join." }, { status: 409 });
  }
  if (now < starts - EARLY_JOIN_MS) return NextResponse.json({ error: "It is not time for this visit yet." }, { status: 409 });
  if (now > ends) return NextResponse.json({ error: "This visit time is over." }, { status: 409 });

  const admin = createAdminClient();
  const { data: resident } = await admin.from("residents").select("comms_suspended").eq("id", contact.resident_id).single();
  if (!isStaff && resident?.comms_suspended) return NextResponse.json({ error: "Visits are currently unavailable." }, { status: 403 });

  const provider = getVideoProvider();
  if (!provider) return NextResponse.json({ error: "Video is not set up yet.", code: "video_not_configured" }, { status: 503 });

  const roomName = `visit-${visit.id}`;
  try {
    const room = await provider.createRoom(roomName, new Date(ends + 10 * 60_000));
    const token = await provider.createToken({
      room: roomName,
      userName: isStaff ? "Staff" : me.full_name,
      userId: me.id,
      observer: isStaff,
      expiresAt: new Date(ends),
    });

    if (!isStaff && visit.status === "approved") {
      await admin
        .from("visits")
        .update({ status: "live", started_at: new Date().toISOString(), daily_room: roomName })
        .eq("id", visit.id)
        .eq("status", "approved");
    }
    if (isStaff) {
      await admin.rpc("log_action", {
        p_facility: visit.facility_id, p_action: "visit.watch", p_entity: "visit", p_entity_id: visit.id, p_detail: {}, p_actor: me.id,
      });
    }
    return NextResponse.json({ url: room.url, token, endsAt: slot.ends_at, observer: isStaff });
  } catch (e) {
    console.error("video join failed", e);
    return NextResponse.json({ error: "Could not start the video call. Please try again." }, { status: 502 });
  }
}
