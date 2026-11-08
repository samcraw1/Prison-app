# Payments: store policy notes and recommended design

**Status:** payments are implemented as described in [`../PAYMENTS.md`](../PAYMENTS.md) (ledger, per-facility prices,
Stripe deposits on the web, mobile purchase links behind flags that are off by default). This document is the store
policy background for that design and still **needs review by counsel** before prices are switched on. Store rules change; verify each point
against the current Apple App Review Guidelines and Google Play Payments policy at decision time.

## How the store rules likely apply to SecureVisit

| SecureVisit service | Likely classification | iOS | Android |
|---|---|---|---|
| Paid **video visits** (live, 1:1, family ↔ resident) | Real-time person-to-person service | Apple guideline 3.1.3(d) allows payment methods other than in-app purchase for real-time one-to-one services between two individuals. One-to-few/one-to-many must use IAP. | Google Play's payments policy has historically exempted payment for physical goods and services delivered outside the app; live person-to-person video is not clearly covered. Confirm with Google before relying on it. |
| Per-message fees / prepaid **message credits** | Digital service consumed in the app | Probably guideline 3.1.1, so in-app purchase is required. | Probably Google Play Billing is required for digital goods and services. |
| Deposits to a resident's **trust/commissary account** | Money transfer to a third party, not content in the app | Generally not IAP; may need to meet financial-services requirements (licensed entity, 3.2.1). | Similar; financial features policy applies. |

US storefronts: court-ordered changes in 2025 (Apple) and the Epic v. Google remedies let developers link to,
and on Android in some cases offer, outside payment options for US users. Check what these allow and what fees
apply at decision time.

## Recommended design if payments are added

- **Source of truth on the server.** Add a `ledger_entries` table (append-only, same pattern as `audit_log`), with
  balances derived from it. Fees are computed in `send_message` / `request_visit` (the `pricing.ts` hook), never
  by a client.
- **Web checkout first.** Stripe Checkout or Payment Element on the website, with a webhook on a Next route that
  writes ledger entries using the service role. No card data touches SecureVisit servers or the apps.
- **Mobile:** show balance and history, read over RLS. Purchasing follows whatever the review above allows:
  external links where permitted, IAP for message credits if required (validated server-side), and ledger
  entries written by a server webhook.
- **Never** put payment provider secret keys in the app. Never store card numbers or bank details.
- **Compliance:** state rate caps for correctional communications, the FCC's rules on incarcerated people's
  communication services, refund rules, and facility revenue-share contracts all bear on pricing.
