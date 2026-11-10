import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";
import { HelpChat } from "./HelpChat";

export const metadata = { title: "Help" };

export default async function HelpPage() {
  const { supabase } = await requireRole(["family"]);
  const { data: available } = await supabase.rpc("help_available");

  return (
    <Card>
      <h1 className="text-xl font-semibold">Help</h1>
      {available ? (
        <div className="mt-4"><HelpChat /></div>
      ) : (
        <p className="mt-3 text-slate-600">The help assistant isn&apos;t available for your facility. Please contact the facility with questions.</p>
      )}
    </Card>
  );
}
