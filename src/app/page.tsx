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
    <main>
      <section className="relative overflow-hidden bg-blue-900 text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hero.svg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
        <div className="relative mx-auto flex max-w-3xl items-center gap-5 px-4 py-14">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/emblem.svg" alt="" className="h-20 w-auto drop-shadow" />
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">{APP_NAME}</h1>
            <p className="mt-2 max-w-md text-blue-100">Secure communication between residents and their families, approved and monitored by facility staff.</p>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="grid gap-4 sm:grid-cols-3">
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
      </div>
    </main>
  );
}
