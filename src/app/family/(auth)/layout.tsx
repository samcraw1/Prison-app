import { APP_NAME } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-14">
      <div className="mb-6 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/emblem.svg" alt="" className="h-12 w-auto" />
        <p className="text-xl font-semibold text-blue-900">{APP_NAME}</p>
      </div>
      {children}
    </main>
  );
}
