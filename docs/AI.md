# AI features (v1.1)

Status: **help bot built and tested** (branch `v1.1-ai`, PR 1 of 3). Translation (PR 2) and staff review assist
(PR 3) are planned, in that order, and not built yet. Everything is **off per facility** until an admin turns it on.

## Principles

- **Opt-in per facility.** Facility contracts may forbid sending content to a third party. Check before enabling.
- **AI never decides.** It never approves, rejects, delivers or hides a message.
- **No AI for residents.** No legal advice.
- **Server-side only.** No model keys in the apps or the browser. Every call goes through Vercel AI Gateway with
  `zeroDataRetention: true` and `disallowPromptTraining: true` (`src/lib/ai/client.ts`). If no provider meets
  both, the request **fails** rather than routing elsewhere.
- **Store only what's needed**, with the retention below. Audit with ids only.

## Owner setup (before turning anything on)

1. Create an AI Gateway key and set `AI_GATEWAY_API_KEY` (server-only) in Vercel.
2. Confirm the model id from the gateway list (`curl -s https://ai-gateway.vercel.sh/v1/models`) and set
   `AI_MODEL` (planned: `anthropic/claude-haiku-5.5`). It has no default.
3. Confirm **zero data retention at both layers**: the gateway (request-level ZDR needs a Vercel Pro or Enterprise
   plan; account-wide ZDR also works) and Anthropic's terms for the routed provider. Keep the written confirmation.
4. Only then, for translation and review assist (PR 2 and 3), set `AI_ALLOW_MESSAGE_CONTENT=true`. The help bot
   never sends message text and doesn't use this switch.
5. Update the privacy policy and the App Store / Play privacy labels ("data sent to a third-party AI service",
   used for app functionality, not linked to identity, not used for tracking).
6. Per facility: get written consent / a contract check, then an admin enables the feature in **Settings → AI
   features**.

Without `AI_MODEL` and a key, the help route answers 503 and nothing calls a model.

## Family help bot

| Piece | Where |
|---|---|
| Tables, functions, grants, retention | `supabase/migrations/20261110000013_ai_help.sql` |
| Platform FAQ (shared by web and app) | `shared/help/default-faq.ts` |
| Chat route (cookie **or** Bearer) | `src/app/api/help/chat/route.ts` |
| Web | `/family/help` (link in the header only when available) |
| App | `mobile/src/app/help.tsx` (Account → Help, only when available) |
| Staff: switch | `/staff/settings` → AI features (admin only) |
| Staff: facility FAQ | `/staff/settings/help` (any staff; audited `help.add/update/delete`) |

**What the model sees:** the instructions, the platform FAQ, and for each facility the family is connected to (home
facility, active contacts, pending requests) **and** that has the bot on: the facility name, its published policies
(review rule, visit length and weekly limit, prices) and its FAQ. Plus the last 10 turns of the chat, text only,
1,000 characters each. Built by `help_context()`; tested to contain no resident, message or account data.

**What it can't do:** it has no tools. It can't see messages, visits, requests, balance or account, and can't act.

**Limits and logging:** 30 questions per family member per day (`take_help_question()`, `help_usage` holds only
`user_id, day, count`). Chat text is never stored. "Report answer" writes `help.report` to the audit log with no
text. Gateway errors are replaced with a generic message.

**Access:** families, only. Staff and residents get 403. Families can't read `facility_help` or `help_usage`
directly; staff read only their facility's FAQ. All writes go through security-definer functions.

## Retention

| Data | Kept | Deleted by |
|---|---|---|
| Help chat text | never stored | — |
| `help_usage` | 30 days | daily cron `/api/cron/ai-retention` → `purge_ai_data()`; immediately when an account is erased |
| `facility_help` | until staff delete it or the facility is removed | staff, cascade |
| Help reports | `audit_log` retention; ids only | n/a (append-only) |
| Translations, AI reviews, job rows | planned for PR 2 and 3 (as long as the message; 90 days; 7 days) | same cron |

## Tests

- `supabase/tests/database/11_ai_help.test.sql`: settings constraint (old and new rules), grants on every new
  table and function, staff-only FAQ editing across facilities, context contents (connected facilities only, no
  resident data), daily limit, report text-free, staff/resident refused, off switch, retention and erasure.
- `tests/integration/help.test.ts` with `tests/integration/fake-llm.ts` (a fake AI Gateway on port 4997, set via
  `AI_API_BASE` in `scripts/test-integration.sh`): auth (none, bad token, staff, resident), off by default,
  malformed bodies, FAQ-only prompt with ZDR flags and no person data, cookie auth, hidden gateway errors, rate
  limit, report logging.

## Open items

- **Settings check, pre-existing:** a *missing* required key (`hold_all_messages`, `max_visit_minutes`,
  `max_visits_per_week`) evaluates to NULL and passes the CHECK. Left unchanged here so the migration can't fail on
  existing rows. Fix separately after checking production data.
- **Answer quality:** check a sample of answers per facility before enabling, and review `help.report` counts.
- **Languages:** the bot answers in the user's language, but the FAQ is English-only.
- **Mobile streaming** uses `expo/fetch` with polyfills (`mobile/src/lib/polyfills.ts`). It's checked by type-check only so
  far. Test it on a device build.
