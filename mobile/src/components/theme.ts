// SecureVisit brand: navy / blue / white (matches the website's Tailwind blue-800/900 + slate palette).
export const colors = {
  primary: "#1e40af",
  primaryDark: "#1e3a8a",
  primarySoft: "#dbeafe",
  primaryTint: "#eff6ff",
  bg: "#f2f4f8", // iOS grouped background, slightly cool
  card: "#ffffff",
  border: "#e2e8f0",
  separator: "#e5e7eb",
  text: "#0f172a",
  muted: "#475569",
  faint: "#64748b", // 4.8:1 on white
  danger: "#b91c1c",
  dangerSoft: "#fef2f2",
  amber: { bg: "#fef3c7", fg: "#92400e" },
  green: { bg: "#dcfce7", fg: "#166534" },
  red: { bg: "#fee2e2", fg: "#991b1b" },
  slate: { bg: "#eef2f6", fg: "#334155" },
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const space = (n: number) => n * 4;

// iOS text styles (points). Text scales with Dynamic Type; containers use minHeight, never fixed heights.
export const type = {
  largeTitle: { fontSize: 32, fontWeight: "700" as const, letterSpacing: 0.2 },
  title: { fontSize: 22, fontWeight: "700" as const },
  headline: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 17, fontWeight: "400" as const },
  callout: { fontSize: 16, fontWeight: "400" as const },
  subhead: { fontSize: 15, fontWeight: "400" as const },
  footnote: { fontSize: 13, fontWeight: "400" as const },
  sectionHeader: { fontSize: 13, fontWeight: "600" as const, letterSpacing: 0.4, textTransform: "uppercase" as const },
};

export const MIN_TOUCH = 44;
