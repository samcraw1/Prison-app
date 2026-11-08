# Resident roster and multi-facility connections

Status: implemented, not yet committed (for review). Migration: `supabase/migrations/20261108000002_roster_multifacility.sql`.
No new environment variables.

## What was reused

| Existing | Role now |
|---|---|
| `residents` | **Is** the roster. Extended in place; ids unchanged, so contacts, messages, visits and audit history keep working |
| `facilities` | Each facility owns its roster; gains `listed`, `roster_source`, `roster_config` |
| `connection_requests` + `decide_connection` | Same staff approval workflow; a roster match still never approves anything |
| `id-photos` bucket | Same private bucket; photos now stored under the **reviewing** facility's folder |
| `audit_log` / `log_action` | Requests, manual links, approvals and every import run are audited |
| RLS model | Families still cannot read `residents` at all |

## Schema changes

`residents` gains:

| Column | Purpose |
|---|---|
| `custody_status` | `active` / `released` / `transferred` (default `active`); only active residents can be matched or approved |
| `admission_date` | Optional, from the facility feed |
| `external_id` | The facility system's stable id; unique per facility |
| `roster_source` | `manual` (staff intake) or `sync` |
| `last_synced_at`, `missing_from_roster_since`, `custody_changed_at` | Sync bookkeeping |
| `updated_at` | Maintained by trigger |

`housing_unit` already existed and stays staff-only (families can't read `residents`).

New tables:

- `roster_lookups`: one row per family lookup (user, facility, matched, time). It stores no names or booking
  numbers and has no client access. It powers rate limiting.
- `roster_sync_runs`: one per import (facility, source, complete-snapshot flag, status, counts, error). Staff of
  that facility can read it.
- `roster_sync_rows`: normalized staged rows for a run, plus their outcome. Service role only.

New and changed functions (all security definer):

| Function | Who | What |
|---|---|---|
| `list_connect_facilities()` | signed-in users | id, name, slug of listed facilities (and your own) |
| `verify_resident(facility, name, booking)` | family | `true`/`false` only; rate-limited |
| `request_connection(facility, name, booking, relationship, id_photo_path)` | family | new 5-argument version; the request belongs to the resident's facility |
| `request_connection(name, booking, relationship, path)` | family | unchanged signature (website); now means "my home facility" |
| `link_request_resident(request, resident)` | staff | staff-assisted verification of an unmatched request (same facility, active resident only) |
| `decide_connection` | staff | also refuses approval if the resident is no longer in custody |
| `send_message`, `request_visit`, `list_open_slots` | family | now use the **contact's** facility (review rules, keywords, slots, weekly limit) |
| `list_open_slots_for_contact(contact)` | family | slots at that contact's facility (app's visit form) |
| `apply_roster_sync(run)` | service role only | applies a staged import (see below) |

Policies: the `id-photos` insert policy allows `{listed facility}/{your user id}/…`; a new `visit_slots` policy lets
families read slot times at facilities where they have an active contact.

Behavior tightening: `request_connection` now requires the ID photo to exist in storage (as `send_message` already
did for attachments). The test fixtures in `02_connections.test.sql` were updated to upload their placeholder files.

## How matching works

1. The app lists facilities with `list_connect_facilities()` and calls `verify_resident(facility, name, booking)`.
2. On the server, the booking number must match exactly (case-insensitive) and the name must match after
   normalization (case, punctuation and extra spaces ignored), for an **active** resident **of that facility**.
3. The only answer is `true` or `false`: no names, ids, housing or custody details. A wrong booking number, a
   released resident and an unknown person all give the same `false`.
4. Abuse limits per family account: 5 unmatched lookups per hour and 20 lookups per day, counting both checks
   and requests. Only family accounts can call it.
5. `request_connection` repeats the match on the server. The client's earlier check is never trusted. A matched
   request is linked to the resident; an unmatched one is filed with `resident_id = null`.
6. Staff at the resident's facility review every request. Matched requests show "Matches …". For an unmatched
   one, staff can compare the details and ID, then **Link resident** (choosing from their own active roster), then
   approve, or simply deny. An unmatched request can't be approved.

## How the app talks to Supabase

Directly, with the signed-in family member's access token and the public anon key. There's no service role in
the app.

- `rpc("list_connect_facilities")` → facility picker
- `rpc("verify_resident", …)` → the **Check details** step
- `storage.from("id-photos").upload("{facility}/{userId}/{uuid}.jpg")` → private, visible to the user and that
  facility's staff only
- `rpc("request_connection", { p_facility, … })` → submit
- `rpc("list_open_slots_for_contact", …)` → the visit request form

The website's family pages keep using the original functions unchanged.

## Future daily roster sync (not scheduled yet)

A per-facility **adapter** (API, CSV or SFTP; facility formats differ) runs server-side with the service role:

1. Insert a `roster_sync_runs` row (`source`, and `is_complete_snapshot` true for a full roster, false for deltas).
2. Parse the feed into normalized `roster_sync_rows` (external id, booking number, name, housing, custody
   status, admission date).
3. Call `apply_roster_sync(run_id)`. It:
   - matches **inside that facility only**, by `external_id` first and then by booking number. A booking-number-only
     match must have the same name; a different name is rejected rather than overwriting the record.
   - updates matched residents in place (housing, custody, admission date; name only via a stable id), so ids
     and history are preserved and there are no duplicates.
   - marks unknown people `new_admission`. Every resident needs a kiosk login, so the adapter provisions it the
     same way staff intake does, inserts the resident with its `external_id`, and the next run links it.
   - **never deletes.** People absent from a *complete* snapshot get `missing_from_roster_since`; custody isn't
     changed automatically. A release or transfer is applied only when the feed says so explicitly. Delta feeds
     never mark anyone missing.
   - rejects invalid rows and identity conflicts per row, records counts, sets the run to
     `succeeded`/`partial`/`failed`, and writes `roster.sync` to the audit log.
4. Scheduling (Vercel Cron, Supabase pg_cron plus an edge function, or a worker) and per-facility credentials
   (Vault or env, never `roster_config`) are not implemented yet.

## Demo data

`npm run db:reset` now also seeds **Riverside Detention Center (fictional)**: staff `staff@riverside.test`
(demo password) and residents `RIV-2001 Jamie Example` and `RIV-2002 Avery Sample`. Families from Demo County can
connect with them.

## Tests

- `supabase/tests/database/06_roster.test.sql`, roughly 70 assertions:
  - facility listing; roster privacy; matching rules; the rate limit
  - storage privacy across facilities
  - cross-facility request, review and link
  - staff approval still required
  - messages and visits follow the contact's facility
  - sync upsert, no duplicates, the missing flag, external-id renames, collision rejection
- `tests/integration/roster.test.ts`: the same flow through the real Auth, PostgREST and Storage APIs, as the app
  does it, including "wrong booking number can't become a connection".
- All earlier suites pass, except the known local Realtime image issue in one integration test.

## Open items / decisions

- **Released residents with existing contacts:** messaging and visits still work until staff block or suspend.
  Decide whether release should automatically pause communication.
- **Website Connect page** still files requests at the home facility (it has no facility picker yet).
- **Staff Residents page** doesn't show custody status or sync history yet.
- **Website visit form:** for a family with contacts at two facilities, it lists slots from both, and the server
  rejects a mismatched pick ("that time is not available"). The app avoids this by loading slots per contact.
- A family can read `resident_id` on **their own** requests (it reveals the same match result they already got).
  If that's unwanted, family request listing should move to an RPC.
