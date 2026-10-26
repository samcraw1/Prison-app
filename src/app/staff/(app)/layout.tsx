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
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
