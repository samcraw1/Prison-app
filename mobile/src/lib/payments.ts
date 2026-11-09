import { Linking, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { apiPost } from "./api";

// Master switch for every payment-related screen and message in the app (balance, add funds, fee notices).
// Off by default: version 1.0 ships without payments. Turn on with EXPO_PUBLIC_PAYMENTS_ENABLED=true in a build
// that App Review has been told about (see docs/PAYMENTS.md). The database enforces fees independently.
export const PAYMENTS_ENABLED = process.env.EXPO_PUBLIC_PAYMENTS_ENABLED === "true";

// How this build lets people add funds. Store rules differ by platform and storefront, so this is a build-time
// flag, off by default, and the decision is documented in docs/PAYMENTS.md. Nothing here touches card data:
// the app asks our API for a Stripe Checkout URL and opens it in the system browser.
//
//  * "external_link": an "Add funds" button that opens Stripe Checkout in the system browser (Safari / the
//    default browser, not an in-app WebView). iOS: only for builds distributed on the US storefront, where Apple
//    allows external purchase links (EXPO_PUBLIC_IOS_EXTERNAL_PURCHASE_LINK=us). Android: off until counsel
//    confirms Google Play's rules (EXPO_PUBLIC_ANDROID_EXTERNAL_PURCHASE_LINK=us).
//  * "website_text": plain text telling people they can add funds on the SecureVisit website. No link or button.
//  * Seam for later: a "store_billing" mode (StoreKit / Play Billing) would validate purchases on the server and
//    write ledger entries from a store webhook, like the Stripe one. Not implemented.
export type PurchaseMode = "external_link" | "website_text";

export function purchaseMode(): PurchaseMode {
  const flag = Platform.OS === "ios" ? process.env.EXPO_PUBLIC_IOS_EXTERNAL_PURCHASE_LINK
    : Platform.OS === "android" ? process.env.EXPO_PUBLIC_ANDROID_EXTERNAL_PURCHASE_LINK
    : undefined;
  return flag === "us" ? "external_link" : "website_text";
}

// Opens Stripe Checkout outside the app. Stripe redirects back to securevisit://wallet (via /api/payments/app-return);
// the balance itself is read from the database, which the webhook updates.
export async function openCheckout(amountCents: number): Promise<void> {
  const { url } = await apiPost<{ url: string }>("/api/payments/checkout", {
    amount_cents: amountCents,
    return_to: "app",
    request_id: Crypto.randomUUID(),
  });
  if (!/^https:\/\//.test(url)) throw new Error("Unexpected checkout address.");
  await Linking.openURL(url);
}
