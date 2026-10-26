"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

export default function ConnectPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const file = f.get("idPhoto") as File | null;
    if (!file || !TYPES[file.type]) return setError("Please upload a JPG, PNG or WebP photo of your ID.");
    if (file.size > MAX_BYTES) return setError("The photo is too large. Maximum size is 5 MB.");

    setBusy(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data: me } = await supabase.from("users").select("id, facility_id").single();
    if (!auth.user || !me) {
      setBusy(false);
      return setError("Please sign in again.");
    }
    const path = `${me.facility_id}/${me.id}/${crypto.randomUUID()}.${TYPES[file.type]}`;
    const up = await supabase.storage.from("id-photos").upload(path, file, { contentType: file.type });
    if (up.error) {
      setBusy(false);
      return setError("Could not upload the photo. Please try again.");
    }
    const { error: rpcError } = await supabase.rpc("request_connection", {
      p_resident_name: String(f.get("residentName")),
      p_booking: String(f.get("booking")),
      p_relationship: String(f.get("relationship")),
      p_id_photo_path: path,
    });
    if (rpcError) {
      setBusy(false);
      return setError("Could not send your request. Check the details and try again.");
    }
    router.replace("/family");
    router.refresh();
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold">Connect with someone</h1>
      <p className="mt-1 text-sm text-slate-600">Facility staff review every request. Your ID photo is only seen by staff and is stored securely.</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <Field label="Resident's full name" name="residentName" required minLength={2} maxLength={100} />
        <Field label="Booking number" name="booking" required pattern="[A-Za-z0-9\-]{3,20}" title="Letters, numbers and dashes" />
        <Field label="Your relationship (for example: Mother, Friend)" name="relationship" required minLength={2} maxLength={40} />
        <Field label="Photo of your government ID" name="idPhoto" type="file" accept="image/jpeg,image/png,image/webp" required />
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
          <Link href="/family" className="rounded-lg border border-slate-300 px-4 py-2.5 font-medium hover:bg-slate-50">Cancel</Link>
        </div>
      </form>
    </Card>
  );
}
