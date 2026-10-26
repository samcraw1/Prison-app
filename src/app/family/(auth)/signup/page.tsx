"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_FACILITY } from "@/lib/config";

export default function FamilySignup() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const body = {
      facility: DEFAULT_FACILITY,
      fullName: String(f.get("fullName")),
      email: String(f.get("email")),
      phone: String(f.get("phone")),
      password: String(f.get("password")),
    };
    const res = await fetch("/api/family/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Something went wrong.");
      setBusy(false);
      return;
    }
    const { error } = await createClient().auth.signInWithPassword({ email: body.email, password: body.password });
    if (error) {
      router.replace("/family/login");
      return;
    }
    router.replace("/family");
    router.refresh();
  }

  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Full name" name="fullName" autoComplete="name" required minLength={2} maxLength={100} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" required />
        <Field label="Password (8+ characters)" name="password" type="password" autoComplete="new-password" required minLength={8} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="w-full">{busy ? "Creating…" : "Create account"}</Button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Already have an account? <Link className="text-blue-800 underline" href="/family/login">Sign in</Link>
      </p>
    </Card>
  );
}
