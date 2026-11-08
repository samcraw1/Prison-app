# Kinline mobile: build, test and release

The family app lives in `mobile/` (Expo SDK 58, Expo Router). It shares the backend with the website:
same Supabase project (Auth, Postgres + RLS, Storage, Realtime) and the same Next.js API routes on Vercel.
There is no separate database or user store for mobile.

```
Website (Next.js, Vercel) ─┐
iOS app (Expo)            ─┼──> Supabase (Auth, Postgres/RLS, Storage, Realtime)
Android app (Expo)        ─┘    Next API routes (/api/visits/:id/join|end, /api/family/signup) ──> Daily
                                push_outbox ──> push-dispatch edge function ──> Expo Push ──> APNs / FCM
```

## Environments

| | Development | Preview (internal testing) | Production |
|---|---|---|---|
| Supabase | local (`npx supabase start`) or a dev project | dev/staging project | prod project |
| Web | `npm run dev` | Vercel Preview deployments | Vercel Production |
| Mobile build | `eas build --profile development` or `npx expo run:ios` | `eas build --profile preview` → TestFlight / Play internal | `eas build --profile production` |
| Bundle id | `com.kinline.app.development` | `com.kinline.app.preview` | `com.kinline.app` |

Each environment's mobile build points at that environment's Supabase and web API through EAS environment
variables (set them in the EAS dashboard or with `eas env:create`):

| Variable | Visibility | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | plain text | same value as the website's `NEXT_PUBLIC_SUPABASE_URL` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | plain text | public anon key; RLS protects the data |
| `EXPO_PUBLIC_API_URL` | plain text | website origin, e.g. `https://kinline-eight.vercel.app` |
| `EXPO_PUBLIC_DEFAULT_FACILITY` | plain text | facility slug for sign-up |
| `EAS_PROJECT_ID` | plain text | from `eas init`; needed for push tokens |
| `IOS_BUNDLE_ID` / `ANDROID_PACKAGE` | plain text | optional overrides of `com.kinline.app` |
| `GOOGLE_SERVICES_JSON` | file secret | Firebase config for Android push |

Never add the Supabase service-role key, `DAILY_API_KEY` or `PUSH_DISPATCH_SECRET` to the mobile app or EAS
`EXPO_PUBLIC_*` variables. `tests/integration/mobile.test.ts` fails if any appear under `mobile/`.

Vercel: set Preview-environment variables to the dev Supabase project and Production to the prod project
(`vercel env add NEXT_PUBLIC_SUPABASE_URL preview`, etc.). The website code needs no changes for mobile.

## Backend setup (once per Supabase project)

1. Apply migrations: `npx supabase link --project-ref <ref> && npx supabase db push`
   (adds the realtime publication, `push_tokens`, `push_outbox` and notification triggers).
2. Deploy the push function and set its secrets:
   ```bash
   npx supabase functions deploy push-dispatch
   npx supabase secrets set PUSH_DISPATCH_SECRET=$(openssl rand -hex 32) EXPO_ACCESS_TOKEN=<optional expo token>
   ```
3. Trigger it on new outbox rows: Dashboard → Database → Webhooks → *Create*: table `public.push_outbox`, event
   `INSERT`, type *Supabase Edge Function* `push-dispatch`, HTTP header `x-dispatch-secret: <same secret>`.
   Optionally also schedule it every minute with pg_cron as a retry sweep.
4. Add the website URL to Auth → URL configuration (unchanged from the website setup).

## Local development

```bash
# terminal 1: backend + website
npx supabase start && npm run db:reset && npm run dev
# terminal 2: mobile
cd mobile && cp .env.example .env.local   # fill in the anon key from `npx supabase status`
npx expo run:ios        # or: npx expo run:android  (first build takes several minutes)
```

The app needs a development build (not Expo Go) because of the Daily WebRTC module. For a physical device on the
same Wi-Fi, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_API_URL` to your Mac's LAN IP, not `localhost`.

Checks before committing: `cd mobile && npx tsc --noEmit && npx expo lint`; at the repo root `npm run lint`,
`npm run test:db`, `npm run test:int`.

## Accounts you need (owner action)

- Apple Developer Program membership; an App Store Connect app record for `com.kinline.app`.
- Google Play Console account; a Play app for `com.kinline.app`.
- Expo account; run `cd mobile && npx eas-cli@latest init` to create the EAS project and get `EAS_PROJECT_ID`.
- Firebase project (Android push): add an Android app `com.kinline.app`, download `google-services.json`, upload it
  as the `GOOGLE_SERVICES_JSON` file variable, and upload the FCM V1 service-account key with `eas credentials`.
- APNs: `eas credentials` creates and stores the push key automatically on the first iOS build.
- Daily account with `DAILY_API_KEY` set on Vercel (already required by the website).

## Building and internal testing

```bash
cd mobile
npx eas-cli@latest build --profile development --platform all   # dev client for device testing
npx eas-cli@latest build --profile preview --platform ios       # then:
npx eas-cli@latest submit --platform ios --latest               # → TestFlight
npx eas-cli@latest build --profile preview --platform android   # APK for direct install, or:
npx eas-cli@latest build --profile production --platform android && npx eas-cli@latest submit --platform android --latest  # → Play internal track (draft)
```

`eas.json` submits Android to the **internal** track as a draft. Set `ascAppId` in `eas.json` before iOS submit.

## Production release

1. Bump `version` in `mobile/app.config.ts` for user-visible releases (build numbers auto-increment remotely).
2. `eas build --profile production --platform all`, then `eas submit` for each platform.
3. JS-only fixes can ship with `eas update --channel production` (no store review), as long as no native module
   or permission changed.

## Store review checklist

- **Demo account for reviewers:** a family account on the production facility with one approved connection and
  a scheduled visit slot staffed during review hours; explain in review notes that Kinline connects families with
  people in a correctional facility, that all messages are reviewed by staff, and that visits are monitored.
- **Apple privacy labels / Google data safety:** collected: name, email, phone, photos (ID and message attachments),
  messages, audio/video during visits (not recorded), device push token. Linked to identity; not used for tracking;
  not sold. Data is shared with the facility (the customer) for review and monitoring.
- **Account deletion:** both stores require in-app account deletion for apps with sign-up. Not built yet; see
  "Open items" in `POC-RESULTS.md`.
- **Permissions text:** camera, microphone, photos and notifications strings are set in `app.config.ts`.
- **Payments:** the app shows the balance and history. "Add funds" opens Stripe Checkout in the system browser only
  when `EXPO_PUBLIC_IOS_EXTERNAL_PURCHASE_LINK=us` / `EXPO_PUBLIC_ANDROID_EXTERNAL_PURCHASE_LINK=us` is set for a build
  that is distributed only where that is allowed; otherwise it says to add funds on the website. Read
  `../PAYMENTS.md` (store-policy decision and open questions) before turning either flag on.
