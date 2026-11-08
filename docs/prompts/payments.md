# Task: Add payments to SecureVisit (web-first Stripe, mobile per store rules)

Repo: samcraw1/Prison-app, branch off `mobile-poc` (or `main` once PR #1 merges).
Read first: README.md, docs/mobile/PAYMENTS-POLICY.md, docs/ROSTER.md, docs/mobile/RELEASE.md,
src/lib/pricing.ts, supabase/migrations/*.sql, mobile/AGENTS.md, AGENTS.md (Next.js 16 has breaking changes;
read node_modules/next/dist/docs before writing Next code).

## Context
SecureVisit = correctional communications: Next.js 16 web app (family / staff / resident kiosk) on Vercel,
Expo SDK 55 family app in mobile/, one Supabase backend (Postgres + RLS, security-definer RPCs, Storage).
Multi-facility: contacts, messages, visits belong to the RESIDENT's facility (contacts.facility_id).
Today nothing is charged: src/lib/pricing.ts returns 0 and messages.fee_cents is always 0.

## Goal
Families can pay for (1) per-message fees and (2) paid video visits, with a prepaid balance and full
transaction history, consistent across web, iOS and Android. Each facility sets its own prices.

## Required architecture
1. **Server-side ledger (source of truth)**
   - Append-only `ledger_entries` table (same immutability pattern as audit_log: triggers block update/delete).
     Columns: id, family_user_id, facility_id, amount_cents (+credit/-debit), currency, kind
     (deposit | message_fee | visit_fee | refund | adjustment), reference (message/visit/stripe id), created_at.
   - Balance = sum of entries (view or security-definer function `my_balance()`); never a mutable balance column.
   - Families can read only their own entries via RLS. Staff can read their facility's entries. Only
     security-definer functions or the service role write them.
2. **Pricing per facility**: facilities.settings gets a rate card (message_fee_cents, visit_fee_cents,
   free_messages_per_week, etc.). Validate it in the existing settings check constraint. Staff admin can edit it
   on /staff/settings.
3. **Charging inside the existing RPCs**: send_message and request_visit compute the fee from the resident
   facility's rate card, check the balance, and write the debit in the same transaction. Insufficient balance
   raises a clear P0001 error. Clients can never set or skip fees. Decide and document what happens on
   rejection/denial/cancel/no-show: a refund entry, never a deletion. Also update src/lib/pricing.ts or remove it
   in favor of the database.
4. **Stripe deposits (web)**
   - Install Stripe through the Vercel Marketplace integration if available; otherwise the official SDK. Load the
     vercel:marketplace skill first.
   - Next route `POST /api/payments/checkout` (authenticated by cookie OR Bearer, reusing
     src/lib/supabase/request.ts `getRequestAuth`) creates a Stripe Checkout Session for a fixed set of deposit
     amounts. Set metadata user_id + facility_id and an idempotency key.
   - `POST /api/payments/webhook` verifies the Stripe signature and writes the ledger credit with the service
     role. Idempotent on event id (unique constraint). Handle checkout.session.completed, refunds and disputes.
   - Family web page /family/wallet: balance, add funds, history.
   - No card data ever touches our servers or the apps. STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are server
     env only.
5. **Mobile (Expo)**
   - New Wallet screen or Account section: balance, history (read over RLS), clear insufficient-balance states in
     the Thread and Request-visit screens.
   - Purchasing, per store policy. Implement behind a feature flag per platform/region:
     - iOS US: an "Add funds" link that opens Stripe Checkout in the SYSTEM browser (expo-web-browser /
       Linking), not a WebView, plus a return deep link (securevisit://wallet). Follow Apple's external-link
       entitlement and placement rules.
     - Paid video visits: evaluate App Store guideline 3.1.3(d) (real-time person-to-person services may use
       other payment methods). Document the conclusion.
     - Outside the US / Android: default to "add funds on the website" text with no link, until counsel confirms.
       Leave a clean seam for StoreKit / Play Billing later. Do NOT implement IAP now.
   - Never put Stripe secret keys in the app; only call our API routes.
6. **Realtime/push**: the balance refreshes after the webhook (realtime on ledger_entries or a refetch on return
   from browser). Push "Funds added" with no amounts beyond what's needed.
7. **Audit**: every deposit, fee, refund and adjustment also goes to audit_log via log_action.

## Constraints
- Don't break the website, staff console, resident kiosk, messaging, visits, video, push, or the roster flow.
- Additive migrations only; keep existing RPC signatures working (web uses them).
- Respect multi-facility rules: fees and settings come from the contact's facility.
- Correctional-telecom compliance (state rate caps, FCC rules on incarcerated people's communication services,
  required free communications): add a docs section listing what must be verified per facility; don't encode
  legal guesses.
- Use test mode only. Never commit secrets. Add env vars to .env.example and docs.

## Tests (must pass)
- pgTAP: ledger immutability; RLS isolation (family/staff/other facility); fee charged inside send_message and
  request_visit; insufficient balance blocks; refunds on reject/deny/cancel per the documented rules; clients
  cannot insert ledger rows or call internal functions.
- Integration (vitest, tests/integration): checkout route auth (cookie + Bearer, 401 without); webhook signature
  required; idempotent replay credits once; balance correct end-to-end. Use a fake Stripe server like
  tests/integration/fake-daily.ts.
- Existing suites: `npm run test:db`, `npm run test:int`, `npm run lint` (3 pre-existing errors are known),
  `npx tsc --noEmit` in root and mobile/.
- Known: one realtime integration test fails locally because of a Supabase Realtime image bug (42P10). Not
  related to this work.

## Deliverables
- Migration(s), API routes, web wallet page, staff rate-card settings, mobile wallet + paywall states,
  tests, and docs/PAYMENTS.md: architecture, env vars, Stripe dashboard setup (webhook endpoint, test keys),
  store-policy decision per platform, and open legal questions.
- Do not commit; leave changes for review and summarize files changed, how to test, and remaining risks.
