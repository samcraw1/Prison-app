import { requireRole } from "@/lib/auth";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { reviewMessage } from "./actions";

export const metadata = { title: "Message review" };

type Row = {
  id: string;
  sender: "family" | "resident";
  body: string;
  status: "held" | "delivered" | "rejected";
  flagged: boolean;
  flag_reasons: string[];
  attachment_path: string | null;
  created_at: string;
  contacts: { relationship: string; residents: { full_name: string; booking_number: string } | null; users: { full_name: string } | null } | null;
};

const SELECT =
  "id, sender, body, status, flagged, flag_reasons, attachment_path, created_at, contacts(relationship, residents(full_name, booking_number), users:users!contacts_family_user_id_fkey(full_name))";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase } = await requireRole(["staff", "admin"]);

  const [held, recent] = await Promise.all([
    supabase.from("messages").select(SELECT).eq("status", "held").order("flagged", { ascending: false }).order("created_at").returns<Row[]>(),
    supabase.from("messages").select(SELECT).eq("status", "delivered").order("created_at", { ascending: false }).limit(15).returns<Row[]>(),
  ]);

  async function withPhoto(r: Row) {
    const photo = r.attachment_path ? (await supabase.storage.from("message-attachments").createSignedUrl(r.attachment_path, 60)).data?.signedUrl : undefined;
    return { ...r, photo };
  }
  const heldRows = await Promise.all((held.data ?? []).map(withPhoto));
  const recentRows = await Promise.all((recent.data ?? []).map(withPhoto));

  return (
    <div className="space-y-8">
      <AutoRefresh seconds={15} />
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Messages waiting for review</h1>
        <ErrorText>{error}</ErrorText>
        {heldRows.length === 0 && <Card><p className="text-slate-600">Nothing is waiting. </p></Card>}
        {heldRows.map((m) => <MessageCard key={m.id} m={m} />)}
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Recently delivered</h2>
        <p className="text-sm text-slate-600">Delivered messages can still be flagged or rejected after the fact.</p>
        {recentRows.map((m) => <MessageCard key={m.id} m={m} />)}
      </section>
    </div>
  );
}

function MessageCard({ m }: { m: Row & { photo?: string } }) {
  const resident = m.contacts?.residents;
  const family = m.contacts?.users;
  const from = m.sender === "family" ? family?.full_name : resident?.full_name;
  const to = m.sender === "family" ? resident?.full_name : family?.full_name;
  return (
    <Card className={m.flagged ? "border-amber-400" : ""}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span className="font-medium text-slate-900">{from}</span>
        <span>→ {to}</span>
        {resident && <span>· {resident.booking_number}</span>}
        <span>· {new Date(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
        {m.flagged && <Badge tone="amber">Flagged{m.flag_reasons.length ? `: ${m.flag_reasons.join(", ")}` : ""}</Badge>}
        <Badge tone={m.sender === "family" ? "blue" : "slate"}>{m.sender === "family" ? "From family" : "From resident"}</Badge>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words">{m.body}</p>
      {m.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.photo} alt="Attachment" className="mt-3 max-h-56 rounded-lg border border-slate-200" />
      )}
      <form action={reviewMessage} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="messageId" value={m.id} />
        <input name="reason" placeholder="Reason (required to reject)" maxLength={300} className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {m.status === "held" && <Button name="action" value="approve">Approve</Button>}
        <Button name="action" value="reject" variant="danger">Reject</Button>
        {!m.flagged && <Button name="action" value="flag" variant="secondary">Flag</Button>}
      </form>
    </Card>
  );
}
