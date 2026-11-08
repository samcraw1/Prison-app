import { describe, expect, it } from "vitest";
import { canCancel, isJoinable, visitPhase } from "../../shared/status";

// Keeps the app's visit labels and Join button in line with the backend:
// join route (approved|live, from 5 min before start to end), expire_visits(), cancel_visit(), end_visit().
const NOW = Date.parse("2026-11-10T15:00:00Z");
const at = (minFromNow: number) => new Date(NOW + minFromNow * 60_000).toISOString();
const v = (status: Parameters<typeof visitPhase>[0]["status"], start: number, end: number, end_reason: Parameters<typeof visitPhase>[0]["end_reason"] = null) =>
  ({ status, end_reason, starts_at: at(start), ends_at: at(end) });

describe("visit join window matches the join route", () => {
  it.each([
    ["approved, 10 min before", "approved", 10, 40, false],
    ["approved, 5 min before", "approved", 5, 35, true],
    ["approved, during", "approved", -5, 25, true],
    ["live, during", "live", -10, 20, true],
    ["approved, after end", "approved", -40, -10, false],
    ["requested, during", "requested", -5, 25, false],
    ["ended", "ended", -20, 10, false],
  ] as const)("%s", (_l, status, s, e, expected) => {
    expect(isJoinable(status, at(s), at(e), NOW)).toBe(expected);
  });
});

describe("visitPhase", () => {
  it.each([
    [v("requested", 60, 90), "pending"],
    [v("requested", -1, 29), "not_reviewed"],
    [v("approved", 60, 90), "upcoming"],
    [v("approved", 3, 33), "ready"],
    [v("approved", -40, -10), "missed"],
    [v("live", -5, 25), "live"],
    [v("live", -40, -10), "completed"],
    [v("ended", -40, -10, "time"), "completed"],
    [v("ended", -40, -10, "staff"), "ended_by_staff"],
    [v("cancelled", 60, 90, "cancelled"), "cancelled"],
    [v("cancelled", -40, -10, "no_show"), "missed"],
    [v("cancelled", -40, -10, "expired"), "not_reviewed"],
    [v("denied", 60, 90), "denied"],
  ] as const)("%j → %s", (visit, phase) => {
    expect(visitPhase(visit, NOW)).toBe(phase);
  });

  it("cancel is offered only for requested/approved visits that aren't joinable (cancel_visit rule)", () => {
    expect(canCancel("requested", false)).toBe(true);
    expect(canCancel("approved", false)).toBe(true);
    expect(canCancel("approved", true)).toBe(false);
    expect(canCancel("live", true)).toBe(false);
    expect(canCancel("ended", false)).toBe(false);
  });
});
