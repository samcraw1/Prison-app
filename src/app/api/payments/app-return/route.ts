import { NextResponse } from "next/server";

// Stripe Checkout success/cancel URLs must be https. When the mobile app started checkout, send the browser on
// to the app's deep link. The app re-reads its balance from the database; this carries no payment data.
export function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") === "success" ? "success" : "cancelled";
  return NextResponse.redirect(`clearline://wallet?status=${status}`, 303);
}
