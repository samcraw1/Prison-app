import { APP_NAME } from "@/lib/config";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-14">
      <p className="mb-6 text-lg font-semibold text-blue-900">{APP_NAME}</p>
      {children}
    </main>
  );
}
