import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Button, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { deleteHelpEntry, saveHelpEntry } from "../actions";

export const metadata = { title: "Help assistant FAQ" };

const area = "w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200";

export default async function HelpFaqPage() {
  const { supabase } = await requireRole(["staff", "admin"]);
  const [{ data: entries }, { data: facility }] = await Promise.all([
    supabase.from("facility_help").select("id, question, answer, updated_at").order("updated_at"),
    supabase.from("facilities").select("settings").single(),
  ]);
  const enabled = Boolean((facility?.settings as { help_bot_enabled?: boolean } | null)?.help_bot_enabled);

  return (
    <div className="space-y-6">
      <Card>
        <Link href="/staff/settings" className="text-sm text-blue-800 underline">← Settings</Link>
        <h1 className="mt-2 text-xl font-semibold">Help assistant FAQ</h1>
        <p className="mt-1 text-sm text-slate-600">
          The family help assistant answers only from these entries, your facility policies and the platform FAQ.
          Write what families should know: visiting rules, ID requirements, mail, phone hours, who to contact.
          Don&apos;t include anything about a specific resident. {enabled ? "The assistant is on." : "The assistant is off; an admin can turn it on in Settings."}
        </p>
      </Card>

      {(entries ?? []).map((e) => (
        <Card key={e.id}>
          <ActionForm action={saveHelpEntry} className="space-y-3">
            <input type="hidden" name="id" value={e.id} />
            <Field label="Question" name="question" defaultValue={e.question} required minLength={3} maxLength={200} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Answer</span>
              <textarea name="answer" defaultValue={e.answer} required maxLength={2000} rows={3} className={area} />
            </label>
            <Button type="submit" variant="secondary">Save</Button>
          </ActionForm>
          <form action={deleteHelpEntry} className="mt-2">
            <input type="hidden" name="id" value={e.id} />
            <button className="text-sm text-red-700 underline">Delete</button>
          </form>
        </Card>
      ))}

      <Card>
        <h2 className="font-semibold">Add an entry</h2>
        <ActionForm action={saveHelpEntry} className="mt-3 space-y-3">
          <Field label="Question" name="question" required minLength={3} maxLength={200} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Answer</span>
            <textarea name="answer" required maxLength={2000} rows={3} className={area} />
          </label>
          <Button type="submit">Add</Button>
        </ActionForm>
      </Card>
    </div>
  );
}
