import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { Card } from "@/components/ui";

const ENTRIES = [
  { href: "/family/login", title: "Family & friends", text: "Message and schedule video visits." },
  { href: "/resident/login", title: "Resident kiosk", text: "Sign in with your booking number." },
  { href: "/staff/login", title: "Facility staff", text: "Review, approve, and monitor." },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
      <p className="mt-2 text-slate-600">Secure communication between residents and their families, approved and monitored by facility staff.</p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {ENTRIES.map((e) => (
          <Link key={e.href} href={e.href}>
            <Card className="h-full transition hover:border-blue-700">
              <h2 className="font-semibold">{e.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{e.text}</p>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-10 text-xs text-slate-500">Demo environment. All people and booking numbers shown are fictional.</p>
    </main>
  );
}
