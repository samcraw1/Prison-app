# 5-minute demo script (jail administrator)

**Before you start (2 min):** `npm run db:reset` then `npm run dev`. Re-seed within ~25 minutes of the demo so the
"visit happening now" is still joinable. Open three browser windows: **Staff** (normal window), **Family** (private
window), **Resident kiosk** (another private window or a tablet). Add `DAILY_API_KEY`/`DAILY_DOMAIN` to `.env.local`
for live video (see README).

Logins (all demo data is fictional): staff `staff@demo-county.test`, admin `admin@demo-county.test`, family
`family1@example.test`, all `DemoPass!234`; resident booking `DEMO-1001`, PIN `123456`.

| Min | Who | Say / do |
|---|---|---|
| 0:00 | Slides/landing | "Families pay high per-minute fees and your staff have no visibility. This is a free pilot: your policies, your approvals, your audit trail." |
| 0:30 | **Family** → sign in `family1` | "Plain, mobile-friendly." Show **Connect with someone**: a new family member submits name, booking number, relationship and a photo ID. Don't submit; show the form. |
| 1:00 | **Staff** → Requests | "Every connection is approved by your staff." Open the pending request: ID photo, requester, resident match. Click **Approve**. Point out the second request marked **No matching resident** (can't be approved, only denied). |
| 1:45 | **Resident kiosk** → `DEMO-1001` / `123456` | "Large touch targets, simple words, no browsing, no links outside the app." Show contacts: only approved people appear. Open Mom's thread. |
| 2:15 | **Family** → Messages → send "See you Saturday" | Show the "Waiting for staff review" label. **Resident** screen: nothing appears yet. |
| 2:45 | **Staff** → Messages | "You choose: hold everything or review after the fact (Settings)." Show the queue: the message with a **Flagged: escape** badge was auto-held by your word list. **Approve** the family message; **Reject** the flagged one (reason required). Resident screen updates within seconds. |
| 3:30 | **Staff** → Settings | "Your word list and your visit limits. Only admins can change policies." Add a word. Show the length/weekly-limit settings. |
| 3:45 | **Staff** → Visits | "Video visits happen in the browser on the kiosk." Approve the waiting request. Show slots you control. |
| 4:15 | Family + Resident → **Join** the visit now | Both join the call. **Staff** → Live now → **Watch** (silent, hidden from participants) → **End visit**; both sides drop. "One click, and it's recorded who ended it." |
| 4:45 | **Staff** → Residents → open a profile | Block a contact or suspend communication in one click; reset a locked PIN. |
| 5:00 | **Staff** → Audit log → **Export CSV** | "Every action by staff, with timestamp and staff ID, exportable. The export itself is logged." Close with the pilot ask: no cost, your data stays in your facility's tenant. |

**If video isn't configured:** skip the join step and say "video runs on a hosted provider; here's the staff
console for scheduling, approval, watching and ending." The Join page shows a clear "Video is not set up yet" message.

**Likely questions**
- *Recording?* Not in the MVP; metadata only (who, when, length, who ended it). The recording hook is marked in the code.
- *Phone calls?* Out of scope for the pilot.
- *Cost to us?* No fees in the MVP; a per-message pricing hook exists but returns zero.
