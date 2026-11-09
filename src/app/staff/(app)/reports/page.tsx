import { requireRole } from "@/lib/auth";
import { Badge, Button, Card, ErrorText } from "@/components/ui";
import { LocalTime } from "@/components/LocalTime";
import { resolveReport } from "./actions";

export const metadata = { title: "Reports" };

const REASONS: Record<string, string> = {
  harassment: "Harassment or abuse", threats: "Threats", inappropriate: "Inappropriate content", spam: "Spam or scam", other: "Something else",
};

type Row = {
  id: string; reason: string; details: string | null; status: string; created_at: string; message_id: string | null;
  users: { full_name: string; email: string } | { full_name: string; email: string }[] | null;
  contacts: { residents: { full_name: string; booking_number: string } | { full_name: string; booking_number: string }[] | null; family_blocked_at: string | null } | null;
};
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

// Reports from family members about messages they received, or a contact in general (App Store guideline 1.2).
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase } = await requireRole(["staff", "admin"]);
  const { data } = await supabase
    .from("content_reports")
    .select("id, reason, details, status, created_at, message_id, users!content_reports_reporter_id_fkey(full_name, email), contacts(family_blocked_at, residents(full_name, booking_number))")
    .order("status", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<Row[]>();
  const rows = data ?? [];
  const messageIds = rows.map((r) => r.message_id).filter((x): x is string => !!x);
  const { data: msgs } = messageIds.length ? await supabase.from("messages").select("id, body").in("id", messageIds) : { data: [] as { id: string; body: string }[] };
  const body = new Map((msgs ?? []).map((m) => [m.id, m.body]));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 && <Card><p className="text-slate-600">No reports.</p></Card>}
      {rows.map((r) => {
        const reporter = one(r.users);
        const resident = one(r.contacts?.residents ?? null);
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-sm">
                <p className="font-medium">{REASONS[r.reason] ?? r.reason} <Badge tone={r.status === "open" ? "amber" : "green"}>{r.status}</Badge>{r.contacts?.family_blocked_at && <> <Badge>blocked by reporter</Badge></>}</p>
                <p className="text-slate-600">From {reporter?.full_name} ({reporter?.email}) about {resident?.full_name} ({resident?.booking_number}) · <LocalTime iso={r.created_at} /></p>
                {r.details && <p>“{r.details}”</p>}
                {r.message_id && <p className="rounded bg-slate-50 p-2 text-slate-700">Reported message: {body.get(r.message_id) ?? "(unavailable)"}</p>}
              </div>
              {r.status === "open" && (
                <form action={resolveReport}><input type="hidden" name="reportId" value={r.id} /><Button variant="secondary">Mark resolved</Button></form>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
