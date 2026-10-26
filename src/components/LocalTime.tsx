"use client";

import { useEffect, useState } from "react";

// Renders in the viewer's own time zone (server and browser zones can differ).
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "time" | "date" }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(iso);
    setText(
      mode === "time" ? d.toLocaleTimeString([], { timeStyle: "short" })
      : mode === "date" ? d.toLocaleDateString([], { dateStyle: "full" })
      : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
    );
  }, [iso, mode]);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
