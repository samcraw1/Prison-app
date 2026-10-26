import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { SignOut } from "@/components/ui";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await requireRole(["staff", "admin"]);
  const { data: facility } = await supabase.from("facilities").select("name").single();
  return (
    <div>
      <header className="border-b border-slate-200 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/staff" className="font-semibold">{APP_NAME} <span className="font-normal text-slate-300">· {facility?.name}</span></Link>
          <div className="flex items-center gap-4 text-sm text-slate-300">
            <span>{profile.full_name} ({profile.role})</span>
            <SignOut next="/staff/login" className="text-white" />
          </div>
        </div>
      </header>
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl gap-6 px-4 py-2 text-sm">
          <Link href="/staff" className="text-slate-700 hover:text-blue-800">Dashboard</Link>
          <Link href="/staff/requests" className="text-slate-700 hover:text-blue-800">Requests</Link>
          <Link href="/staff/messages" className="text-slate-700 hover:text-blue-800">Messages</Link>
          <Link href="/staff/visits" className="text-slate-700 hover:text-blue-800">Visits</Link>
          <Link href="/staff/residents" className="text-slate-700 hover:text-blue-800">Residents</Link>
          <Link href="/staff/settings" className="text-slate-700 hover:text-blue-800">Settings</Link>
          <Link href="/staff/audit" className="text-slate-700 hover:text-blue-800">Audit log</Link>
          {profile.role === "admin" && <Link href="/staff/team" className="text-slate-700 hover:text-blue-800">Team</Link>}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
