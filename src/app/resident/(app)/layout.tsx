import { requireRole } from "@/lib/auth";
import { APP_NAME } from "@/lib/config";
import { SignOut } from "@/components/ui";

export default async function ResidentLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireRole(["resident"]);
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between bg-blue-900 px-6 py-4 text-white">
        <span className="text-2xl font-semibold">{APP_NAME}</span>
        <div className="flex items-center gap-6 text-lg">
          <span>{profile.full_name}</span>
          <SignOut next="/resident/login" className="text-white" />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
