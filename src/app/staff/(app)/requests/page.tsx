import { requireRole } from "@/lib/auth";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { decideRequest } from "./actions";

export const metadata = { title: "Connection requests" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase } = await requireRole(["staff", "admin"]);
  const { data: requests } = await supabase
    .from("connection_requests")
    .select("id, typed_resident_name, typed_booking_number, relationship, id_photo_path, resident_id, created_at, users!connection_requests_family_user_id_fkey(full_name, email, phone), residents(full_name, booking_number)")
    .eq("status", "pending")
    .order("created_at");

  const withPhotos = await Promise.all(
    (requests ?? []).map(async (r) => {
      const { data } = await supabase.storage.from("id-photos").createSignedUrl(r.id_photo_path, 60);
      return { ...r, photoUrl: data?.signedUrl };
    }),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Connection requests</h1>
      <ErrorText>{error}</ErrorText>
      {withPhotos.length === 0 && <Card><p className="text-slate-600">No pending requests.</p></Card>}
      {withPhotos.map((r) => {
        const family = Array.isArray(r.users) ? r.users[0] : r.users;
        const resident = Array.isArray(r.residents) ? r.residents[0] : r.residents;
        return (
          <Card key={r.id}>
            <div className="grid gap-6 md:grid-cols-[1fr_220px]">
              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Requester</p>
                  <p className="font-medium">{family?.full_name}</p>
                  <p className="text-sm text-slate-600">{family?.email} · {family?.phone}</p>
                  <p className="text-sm text-slate-600">Relationship: {r.relationship}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Wants to connect with</p>
                  <p className="font-medium">{r.typed_resident_name} <span className="text-slate-500">· {r.typed_booking_number}</span></p>
                  {resident ? (
                    <Badge tone="green">Matches {resident.full_name} ({resident.booking_number})</Badge>
                  ) : (
                    <Badge tone="red">No matching resident</Badge>
                  )}
                </div>
                <form action={decideRequest} className="flex flex-wrap items-end gap-3 pt-2">
                  <input type="hidden" name="requestId" value={r.id} />
                  <input name="reason" placeholder="Reason (if denying)" maxLength={300} className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <Button name="approve" value="true" disabled={!r.resident_id}>Approve</Button>
                  <Button name="approve" value="false" variant="danger">Deny</Button>
                </form>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Photo ID</p>
                {r.photoUrl ? (
                  <a href={r.photoUrl} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.photoUrl} alt="Submitted ID" className="w-full rounded-lg border border-slate-200" />
                  </a>
                ) : (
                  <p className="text-sm text-slate-500">Photo unavailable</p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
