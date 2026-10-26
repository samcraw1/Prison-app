"use client";

import { useActionState, useState } from "react";
import { changePin } from "./actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

export function ChangePinForm() {
  const [state, action, pending] = useActionState(changePin, {} as { error?: string });
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"new" | "confirm">("new");
  const value = step === "new" ? pin : confirm;
  const set = step === "new" ? setPin : setConfirm;

  function press(k: string) {
    if (k === "clear") set("");
    else if (k === "back") set((p) => p.slice(0, -1));
    else set((p) => (p.length < 8 ? p + k : p));
  }

  return (
    <form action={action} className="mx-auto max-w-md space-y-4">
      <h1 className="text-3xl font-semibold">Choose a new PIN</h1>
      <p className="text-xl text-slate-600">{step === "new" ? "Pick 6 to 8 numbers you will remember." : "Type the same PIN again."}</p>
      <input type="hidden" name="pin" value={pin} />
      <input type="hidden" name="confirm" value={confirm} />
      <div className="flex h-14 items-center justify-center gap-3 rounded-xl border-2 border-slate-300 bg-white" aria-label={`${value.length} digits entered`}>
        {[...value].map((_, i) => <span key={i} className="h-4 w-4 rounded-full bg-slate-800" />)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} className="h-16 rounded-xl border-2 border-slate-300 bg-white text-2xl font-medium active:bg-slate-100">
            {k === "clear" ? "Clear" : k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
      {state.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">{state.error}</p>}
      {step === "new" ? (
        <button type="button" disabled={pin.length < 6} onClick={() => setStep("confirm")} className="h-16 w-full rounded-xl bg-blue-800 text-2xl font-semibold text-white disabled:opacity-40">Next</button>
      ) : (
        <button type="submit" disabled={pending || confirm.length < 6} className="h-16 w-full rounded-xl bg-blue-800 text-2xl font-semibold text-white disabled:opacity-40">{pending ? "Saving…" : "Save PIN"}</button>
      )}
    </form>
  );
}
