import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { ChangePinForm } from "./ChangePinForm";

export default async function ChangePinPage() {
  const { supabase } = await requireRole(["resident"]);
  const { data: resident } = await supabase.from("residents").select("must_change_pin").single();
  if (!resident?.must_change_pin) redirect("/resident");
  return <ChangePinForm />;
}
