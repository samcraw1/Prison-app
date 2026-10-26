"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME, DEFAULT_FACILITY } from "@/lib/config";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

export function KioskLogin() {
  const router = useRouter();
  const facility = useSearchParams().get("f") ?? DEFAULT_FACILITY;
  const [booking, setBooking] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function press(k: string) {
    setError(undefined);
    if (k === "clear") setPin("");
    else if (k === "back") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < 8 ? p + k : p));
  }

  async function submit() {
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/resident/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facility, booking, pin }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Please try again.");
      setPin("");
      setBusy(false);
      return;
    }
    router.replace("/resident");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      <h1 className="mb-8 text-center text-4xl font-semibold text-blue-900">{APP_NAME}</h1>
      <label className="mb-1 text-xl font-medium" htmlFor="booking">Booking number</label>
      <input
        id="booking"
        value={booking}
        onChange={(e) => setBooking(e.target.value.trim())}
        autoComplete="off"
        className="mb-6 rounded-xl border-2 border-slate-300 px-4 py-4 text-2xl focus:border-blue-700 focus:outline-none"
      />
      <p className="mb-1 text-xl font-medium">PIN</p>
      <div className="mb-4 flex h-14 items-center justify-center gap-3 rounded-xl border-2 border-slate-300 bg-white" aria-label={`${pin.length} digits entered`}>
        {pin.length === 0 ? <span className="text-slate-400">Enter your PIN</span> : [...pin].map((_, i) => <span key={i} className="h-4 w-4 rounded-full bg-slate-800" />)}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="h-16 rounded-xl border-2 border-slate-300 bg-white text-2xl font-medium active:bg-slate-100"
          >
            {k === "clear" ? "Clear" : k === "back" ? "⌫" : k}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy || pin.length < 6 || booking.length < 3}
        className="mt-6 h-16 rounded-xl bg-blue-800 text-2xl font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Please wait…" : "Sign in"}
      </button>
    </main>
  );
}
