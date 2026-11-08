"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// Account deletion: 30-day grace period, cancellable. Re-entering the password guards against a shared computer.
export function DeleteAccount({ email, balanceLabel, balanceCents, scheduledFor }: {
  email: string; balanceLabel: string; balanceCents: number; scheduledFor: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function request() {
    setBusy(true);
    setError(undefined);
    const supabase = createClient();
    const auth = await supabase.auth.signInWithPassword({ email, password });
    if (auth.error) { setError("That password isn't right."); setBusy(false); return; }
    const { error: e } = await supabase.rpc("request_account_deletion");
    setBusy(false);
    if (e) { setError("Couldn't start deletion. Please try again."); return; }
    setPassword("");
    setOpen(false);
    router.refresh();
  }
  async function cancel() {
    setBusy(true);
    const { error: e } = await createClient().rpc("cancel_account_deletion");
    setBusy(false);
    if (e) { setError("Couldn't cancel. Please try again."); return; }
    router.refresh();
  }

  if (scheduledFor) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Deletion scheduled</h2>
        <p className="mt-2 text-slate-700">
          Your account will be deleted on {new Date(scheduledFor).toLocaleDateString(undefined, { dateStyle: "long" })}. Until then you can
          keep using SecureVisit. After that your name, email, phone and ID photo are erased and you can&apos;t sign in. Messages and
          visits stay in the facility&apos;s records as &ldquo;Deleted user&rdquo;.
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="mt-4"><Button variant="secondary" disabled={busy} onClick={cancel}>Keep my account</Button></div>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="text-lg font-semibold">Delete account</h2>
      {!open ? (
        <div className="mt-3"><Button variant="secondary" onClick={() => setOpen(true)}>Delete my account</Button></div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-slate-700">
            Your account is deleted 30 days after you confirm, and you can cancel any time before then. Your name, email, phone and
            ID photo are erased, and you won&apos;t be able to sign in. Messages and visits stay in the facility&apos;s records as
            &ldquo;Deleted user&rdquo;.
            {balanceCents > 0 && ` Your remaining balance of ${balanceLabel} will be forfeited and cannot be refunded.`}
          </p>
          <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <Button variant="danger" disabled={busy || !password} onClick={request}>Delete my account</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Never mind</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
