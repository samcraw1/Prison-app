"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/lib/staff-context";

// Wraps a server action that returns { ok, error, message, pin }. A one-time PIN is shown once, never put in a URL.
export function ActionForm({
  action,
  children,
  className = "",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state.ok && (
        <div role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
          {state.message}
          {state.pin && (
            <p className="mt-1">One-time PIN: <span className="font-mono text-lg font-semibold tracking-widest">{state.pin}</span> <span className="text-green-800">(shown once; the resident must change it at first sign-in)</span></p>
          )}
        </div>
      )}
    </form>
  );
}
