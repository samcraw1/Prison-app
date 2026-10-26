import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Badge, Button, Card, Field } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createStaff, setStaffActive } from "./actions";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const { supabase, profile } = await requireRole(["staff", "admin"]);
  if (profile.role !== "admin") redirect("/staff");
  const { data: team } = await supabase.from("users").select("id, full_name, email, role, status").in("role", ["staff", "admin"]).order("full_name");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="p-0">
        <h1 className="px-5 pt-5 text-xl font-semibold">Staff accounts</h1>
        <ul className="mt-3 divide-y divide-slate-100">
          {(team ?? []).map((u) => (
            <li key={u.id} className="flex items-center justify-between px-5 py-3">
              <span>
                <span className="font-medium">{u.full_name}</span>
                <span className="ml-2 text-sm text-slate-500">{u.email}</span>
              </span>
              <span className="flex items-center gap-3">
                <Badge tone={u.role === "admin" ? "blue" : "slate"}>{u.role}</Badge>
                {u.status === "suspended" && <Badge tone="red">Deactivated</Badge>}
                {u.id !== profile.id && (
                  <form action={setStaffActive}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value={String(u.status !== "active")} />
                    <Button variant="secondary" className="py-1.5 text-sm">{u.status === "active" ? "Deactivate" : "Reactivate"}</Button>
                  </form>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="h-fit">
        <h2 className="font-semibold">Add a staff member</h2>
        <ActionForm action={createStaff} className="mt-4 space-y-3">
          <Field label="Full name" name="fullName" required minLength={2} maxLength={100} />
          <Field label="Email" name="email" type="email" required />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Role</span>
            <select name="role" className="w-full rounded-lg border border-slate-300 px-3 py-2.5">
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button type="submit" className="w-full">Add staff member</Button>
        </ActionForm>
      </Card>
    </div>
  );
}
