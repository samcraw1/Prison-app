import { requireRole } from "@/lib/auth";
import { Button, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { addKeyword, removeKeyword, saveSettings } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase, profile } = await requireRole(["staff", "admin"]);
  const [{ data: facility }, { data: keywords }] = await Promise.all([
    supabase.from("facilities").select("settings").single(),
    supabase.from("flag_keywords").select("id, word").order("word"),
  ]);
  const s = (facility?.settings ?? {}) as { hold_all_messages: boolean; max_visit_minutes: number; max_visits_per_week: number };
  const isAdmin = profile.role === "admin";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h1 className="text-xl font-semibold">Facility policies</h1>
        {!isAdmin && <p className="mt-1 text-sm text-slate-600">Only a facility admin can change these.</p>}
        <ActionForm action={saveSettings} className="mt-4 space-y-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" name="hold_all_messages" defaultChecked={s.hold_all_messages} disabled={!isAdmin} className="mt-1 h-4 w-4" />
            <span>
              <span className="font-medium">Hold every message for staff approval</span>
              <span className="block text-sm text-slate-600">If off, messages are delivered right away and kept for later review. Flagged messages are always held.</span>
            </span>
          </label>
          <Field label="Longest video visit (minutes)" name="max_visit_minutes" type="number" min={5} max={120} defaultValue={s.max_visit_minutes} disabled={!isAdmin} required />
          <Field label="Most visits per resident each week" name="max_visits_per_week" type="number" min={1} max={14} defaultValue={s.max_visits_per_week} disabled={!isAdmin} required />
          {isAdmin && <Button type="submit">Save policies</Button>}
        </ActionForm>
      </Card>

      <Card>
        <h2 className="text-xl font-semibold">Flagged words</h2>
        <p className="mt-1 text-sm text-slate-600">Messages containing these whole words are always held for review.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {(keywords ?? []).map((k) => (
            <li key={k.id}>
              <form action={removeKeyword} className="flex items-center gap-1 rounded-full bg-amber-100 py-1 pl-3 pr-1 text-sm text-amber-900">
                <input type="hidden" name="keywordId" value={k.id} />
                {k.word}
                <button aria-label={`Remove ${k.word}`} className="rounded-full px-2 py-0.5 hover:bg-amber-200">×</button>
              </form>
            </li>
          ))}
          {(keywords ?? []).length === 0 && <li className="text-slate-600">No words yet.</li>}
        </ul>
        <ActionForm action={addKeyword} className="mt-4 flex items-end gap-3">
          <div className="flex-1"><Field label="Add a word" name="word" required maxLength={40} /></div>
          <Button type="submit">Add</Button>
        </ActionForm>
      </Card>
    </div>
  );
}
