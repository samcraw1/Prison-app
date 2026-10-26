"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type JoinInfo = { url: string; token: string; endsAt: string; observer: boolean };

export function VideoRoom({ visitId, backHref, large = false }: { visitId: string; backHref: string; large?: boolean }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [joined, setJoined] = useState(false);
  const [info, setInfo] = useState<JoinInfo>();
  const [remaining, setRemaining] = useState<number>();

  useEffect(() => {
    let frame: { destroy: () => Promise<void>; join: (o: { url: string; token: string }) => Promise<unknown>; on: (e: string, cb: () => void) => unknown } | undefined;
    let cancelled = false;

    (async () => {
      const res = await fetch(`/api/visits/${visitId}/join`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) return setError(body.error ?? "Could not join the visit.");
      setInfo(body);

      const { default: Daily } = await import("@daily-co/daily-js");
      if (cancelled || !container.current) return;
      frame = Daily.createFrame(container.current, {
        showLeaveButton: true,
        showFullscreenButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "12px" },
      }) as unknown as typeof frame;
      frame!.on("left-meeting", () => router.replace(backHref));
      await frame!.join({ url: body.url, token: body.token });
      if (!cancelled) setJoined(true);
    })().catch(() => !cancelled && setError("Could not start the video call."));

    return () => {
      cancelled = true;
      frame?.destroy().catch(() => {});
    };
  }, [visitId, backHref, router]);

  useEffect(() => {
    if (!info) return;
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(info.endsAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [info]);

  if (error) {
    return (
      <div className="space-y-4">
        <p role="alert" className={`rounded-xl bg-red-50 px-4 py-3 text-red-800 ${large ? "text-2xl" : ""}`}>{error}</p>
        <a href={backHref} className={`inline-block rounded-xl border border-slate-300 bg-white px-5 py-3 ${large ? "text-2xl" : ""}`}>Go back</a>
      </div>
    );
  }

  const mm = remaining === undefined ? "" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <div className="space-y-3">
      <div className={`flex items-center justify-between ${large ? "text-2xl" : "text-sm"} text-slate-600`}>
        <span>{info?.observer ? "Watching (staff view, silent)" : joined ? "Connected" : "Connecting…"}</span>
        {mm && <span>Time left: <strong>{mm}</strong></span>}
      </div>
      <div ref={container} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl bg-slate-900" />
      {!info?.observer && <p className={`text-slate-500 ${large ? "text-lg" : "text-xs"}`}>This visit may be monitored by facility staff.</p>}
    </div>
  );
}
