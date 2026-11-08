# In-app account deletion (family accounts)

Apple guideline 5.1.1(v) requires apps with account creation to let users start deletion inside the app. **Implemented, not yet committed.**

## Decisions
- Messages and visits are **kept** as facility records; the family sender shows as "Deleted user".
- Available in the Expo app (Account tab) and on the website (`/family/account`).
- **30-day grace period**, cancellable by signing in and tapping "Keep my account".
- A positive balance is **forfeited**, with a warning before the request (assumed; not yet confirmed with the product owner).

## Why not a hard delete
`ledger_entries.family_user_id` is `on delete restrict` (financial records must outlive an account), so the auth user and `public.users` row cannot be deleted. The account is anonymized in place and the sign-in disabled.

## Flow
1. **Request** (`request_account_deletion()` RPC, family only): the app first re-checks the password. Sets `users.deletion_requested_at` / `deletion_scheduled_for` (now + 30 days). Asking again does not move the date. The account stays fully usable.
2. **Cancel** (`cancel_account_deletion()`): clears both columns.
3. **Erase** (daily Vercel cron `GET /api/cron/erase-accounts`, `Authorization: Bearer $CRON_SECRET`), for accounts past `deletion_scheduled_for`, in an order that makes failures retryable:
   1. delete the ID photos in the `id-photos` bucket (`<facility>/<user>/`),
   2. auth admin: placeholder email, random password, indefinite ban,
   3. `erase_family_account(user)`: deletes `push_tokens` and `roster_lookups`, sets `connection_requests.id_photo_path = 'erased'`, blocks the user's contacts, anonymizes `public.users` (email `deleted+<id>@invalid`, name "Deleted user", no phone, `status = 'deleted'`, `erased_at`), writes `account.erased` to the audit log. Idempotent.

## Kept
`ledger_entries`, `audit_log`, messages, visits, and the resident-side details in `connection_requests` (typed resident name / booking number).

## Before production
- Set `CRON_SECRET` in Vercel (the cron is declared in `vercel.json`; it returns 401 without it).
- Update the privacy policy and App Review notes: deletion is requested in-app and completes after 30 days; messages and visits are retained by the facility.
- Product/legal: confirm the retention of messages and visits, and the forfeited-balance rule, with the facility contracts.

## Tests
pgTAP `supabase/tests/database/08_account_deletion.test.sql`; integration `tests/integration/account-deletion.test.ts` (cron auth, request/cancel, no early erasure, full erasure including photo and sign-in, idempotency).
