# Mobile proof of concept: results

Date: 2026-11-08. Scope: the five checks agreed before building the full family app. "Verified" means checked by
an automated test or a run in this environment. "Pending (owner)" means it needs your devices, accounts or
credentials; step-by-step instructions are below.

| # | Check | Result |
|---|---|---|
| 1 | Same Supabase account on mobile and web | SIM_RESULT_1 |
| 2 | Messages sync in real time between mobile, web and the staff queue | SIM_RESULT_2 |
| 3 | Daily video: join, staff monitoring, staff ending the visit, time limit | Server side **verified** (integration tests). Native call on a physical device: **pending (owner)**, needs `DAILY_API_KEY` and two phones |
| 4 | RLS, security-definer functions and Bearer auth are secure | **Verified**: pgTAP 151/151, Bearer and secret-scan integration tests pass |
| 5 | Push notifications without sensitive resident information | Payload privacy **verified** (pgTAP). Delivery to a device: **pending (owner)**, needs EAS project + APNs/FCM |

## What was tested

**Database (pgTAP, `npm run test:db`): 151 tests pass.** That includes the existing suites plus
`05_realtime_push.test.sql`:
- `messages`, `visits`, `connection_requests` and `contacts` are in the realtime publication. `push_outbox`,
  `push_tokens`, `audit_log`, `residents` and `users` are not.
- Push tokens: users see only their own; clients cannot insert them directly; residents and staff cannot register
  them; one user cannot remove another user's token.
- Clients cannot read `push_outbox`, call `enqueue_push` or call `claim_push_batch`.
- A held resident message does **not** notify the family. Once staff approve it, one notification is queued.
- The queued notification text contains no message body, resident name, booking number or rejection reason. It
  carries only `{type, id}`.
- No outbox rows are created for users with no registered device.

**Web API (`npm run test:int`, `tests/integration/mobile.test.ts`).** Every existing integration test still passes. Plus:
- Bearer auth on `/api/visits/:id/join` and `/end`. These return 401: no token, a malformed token, a `Basic`
  scheme, a correctly shaped token with a forged signature, and a token from a session that has signed out. Another
  family's visit returns 404. A family member trying to end a visit gets 403.
- A valid family Bearer token can join. Staff with a Bearer token join as hidden, receive-only observers. Staff
  ending a visit deletes the Daily room, which ejects everyone, and a second join then gets 409.
- Time limit: tokens now carry `exp = slot end` **and** `eject_at_token_exp: true`, so Daily removes participants
  when the slot ends. Before this change participants could stay up to 10 minutes past the slot, until the room
  itself expired. The app and website countdowns are display only; the server-side token enforces the limit.
- No server secret appears anywhere in `mobile/`. The test scans for the service-role key, Daily key, push
  secret and `sb_secret_` keys.
- Anonymous realtime subscribers receive no message rows.

**Realtime delivery to a signed-in user: blocked by local tooling.** The local Supabase Realtime container
(`supabase/realtime:v2.147.1`, from Supabase CLI 3.0.0, the latest) rejects *every* `postgres_changes`
subscription with `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`.
The image's code does not match its own `realtime.subscription` schema. The error is in Supabase's internal
`realtime` schema, not in Kinline's tables, and it also happens for a family member's own message. The test
`realtime respects RLS > delivers a resident message only to that resident's family` fails on it and reports the
server error. Hosted Supabase runs a maintained Realtime version. **Owner action:** run `npm run test:int` against
the dev Supabase project, or rerun locally after the next CLI update, to confirm. Until then the website and app
fall back to polling: the thread every 20 s on mobile and 10 s on web, visits every 30 s, plus pull-to-refresh and
refetch when the app returns to the foreground. So nothing is broken, only slower.

SIM_SECTION

## Physical-device checklist (owner)

Prerequisites: `DAILY_API_KEY` set for the web app; a development build installed on an iPhone and an Android phone
(`cd mobile && npx eas-cli@latest build --profile development`); `EXPO_PUBLIC_API_URL` and
`EXPO_PUBLIC_SUPABASE_URL` reachable from the phones (dev Supabase project + Vercel preview URL, or your Mac's LAN IP).

1. Sign in on the iPhone as `family1@example.test`. On a laptop, sign in at `/resident/login` as `DEMO-1001` / PIN
   `123456`. As staff, create a slot starting now and approve family1's visit request.
2. **Join:** tap *Join visit* on the phone. Expect camera and microphone prompts, then the resident's video
   full-screen with your own video in the corner. Check audio both ways, mute/unmute, camera off/on and flipping
   the camera.
3. **Monitoring:** as staff, open the visit and click *Watch*. Expect no new tile and no "joined" signal on the phone.
4. **Staff ends the visit:** click *End visit*. The phone should show "This visit was ended by facility staff."
   within a few seconds.
5. **Time limit:** create a 3-minute slot and join. Expect the countdown to turn red at 1:00, and the call to end
   with "Time is up" at 0:00, even if the phone is locked or backgrounded.
6. **Background/lock:** during a call, lock the phone for 30 s. Audio should continue (iOS `voip`/`audio` modes;
   Android foreground service notification).
7. Repeat steps 2–6 on the Android phone.
8. **Push:** with the dev build, allow notifications. As staff, approve a resident message to family1. The phone
   should show "New message — You have a new message. Open the app to read it." with no text from the message.
   Tap it: the thread opens. Do the same for a visit approval and a connection approval.

Record results in this file. If any step fails, note the device model and OS version and the visit id.

## Known gaps and decisions for you

- **Daily's Expo config plugin** (`@daily-co/config-plugin-rn-daily-js` 0.0.13) declares support only for
  Expo SDK 55–57. This app uses SDK 58, so the plugin's job is done in `app.config.ts` plus a small local plugin
  (`mobile/plugins/withDailyNative.js`, which adds the Android foreground service). Device testing (above) is the
  gate. If Daily ships an SDK 58 plugin, switch to it.
- **Account deletion:** Apple and Google require in-app account deletion for apps that allow sign-up. Correctional
  record retention may conflict with deleting data. Decide the policy (for example, deactivate the account and
  erase personal data where the facility's retention rules allow it). It is not built yet.
- **Visit-starting-soon notices** are local notifications scheduled on the phone, 10 minutes before an approved
  visit. They need no server job. Remote "starting soon" pushes would need pg_cron.
- **Payments:** deferred. See `PAYMENTS-POLICY.md`.
- **Push delivery webhook:** creating the Database Webhook from `push_outbox` to `push-dispatch` is a manual
  dashboard step per project (`RELEASE.md`, backend setup step 3).
