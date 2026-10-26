import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { SignOut } from "@/components/ui";

export default async function FamilyLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireRole(["family"]);
  return (
    <div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/family" className="font-semibold text-blue-900">{APP_NAME}</Link>
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <span>{profile.full_name}</span>
            <SignOut next="/family/login" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
