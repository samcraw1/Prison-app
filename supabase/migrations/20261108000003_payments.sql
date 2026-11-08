-- Payments: prepaid family balance backed by an append-only ledger, per-facility prices, and fees charged inside
-- the same transaction as the message or visit they pay for. See docs/PAYMENTS.md.
--
-- * public.ledger_entries is the source of truth. A balance is always the sum of a user's entries; there is no
--   mutable balance column. Rows are never updated or deleted (same triggers as audit_log); corrections are new
--   rows (refund / adjustment).
-- * Fees are computed and debited by BEFORE INSERT triggers on messages and visits. Every existing write path
--   (send_message, request_visit) therefore charges without changing its signature, and no client can set or skip
--   a fee: clients cannot insert those tables directly.
-- * Refunds are written by AFTER UPDATE triggers when a paid message is rejected or a paid visit never happens.
-- * Deposits and Stripe reversals are written only by service-role functions called from the verified Stripe
--   webhook. Every ledger row is also written to audit_log.
-- Additive only: existing tables, RPC signatures and behaviour (with all prices at 0) are unchanged.

-- ------------------------------------------------------------------ rate card
-- Prices live in facilities.settings with the other policies. Missing keys mean 0 (free), so existing facilities
-- keep working exactly as before until an admin sets prices.
alter table public.facilities alter column settings set default jsonb_build_object(
  'hold_all_messages', true,
  'max_visit_minutes', 30,
  'max_visits_per_week', 2,
  'message_fee_cents', 0,
  'visit_fee_cents', 0,
  'free_messages_per_week', 0
);

alter table public.facilities drop constraint facility_settings_valid;
alter table public.facilities
  add constraint facility_settings_valid check (
    jsonb_typeof(settings->'hold_all_messages') = 'boolean'
    and (settings->>'max_visit_minutes') ~ '^[0-9]+$'
    and (settings->>'max_visit_minutes')::int between 5 and 120
    and (settings->>'max_visits_per_week') ~ '^[0-9]+$'
    and (settings->>'max_visits_per_week')::int between 1 and 14
    -- Optional rate card (whole cents). Caps are sanity limits, not legal rate caps: see docs/PAYMENTS.md.
    and (not settings ? 'message_fee_cents'
         or ((settings->>'message_fee_cents') ~ '^[0-9]{1,4}$' and (settings->>'message_fee_cents')::int <= 500))
    and (not settings ? 'visit_fee_cents'
         or ((settings->>'visit_fee_cents') ~ '^[0-9]{1,5}$' and (settings->>'visit_fee_cents')::int <= 5000))
    and (not settings ? 'free_messages_per_week'
         or ((settings->>'free_messages_per_week') ~ '^[0-9]{1,3}$' and (settings->>'free_messages_per_week')::int <= 500))
  );

create function public.rate_card(p_facility uuid)
returns table (message_fee_cents int, visit_fee_cents int, free_messages_per_week int)
language sql stable security definer set search_path = public as $$
  select coalesce((f.settings->>'message_fee_cents')::int, 0),
         coalesce((f.settings->>'visit_fee_cents')::int, 0),
         coalesce((f.settings->>'free_messages_per_week')::int, 0)
    from public.facilities f where f.id = p_facility
$$;
revoke execute on function public.rate_card(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ ledger
create type public.ledger_kind as enum ('deposit', 'message_fee', 'visit_fee', 'refund', 'adjustment');

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  -- Restrict: financial history must outlive an account. Close accounts by suspending them.
  family_user_id uuid not null references public.users (id) on delete restrict,
  -- Fees: the resident's facility (the one that set the price). Deposits: the family member's home facility.
  facility_id uuid not null references public.facilities (id),
  amount_cents int not null check (amount_cents <> 0 and abs(amount_cents) <= 100000),  -- + credit, - debit
  currency text not null default 'usd' check (currency = 'usd'),
  kind public.ledger_kind not null,
  -- message:<uuid> | visit:<uuid> for fees and their refunds; Stripe ids (pi_, re_, du_) for card money.
  reference text not null check (char_length(reference) between 3 and 200),
  refund_of bigint references public.ledger_entries (id),
  stripe_event_id text unique,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  check (case kind
           when 'deposit' then amount_cents > 0
           when 'message_fee' then amount_cents < 0
           when 'visit_fee' then amount_cents < 0
           when 'refund' then refund_of is not null
           else true end)
);
-- One fee per message/visit, one refund per fee, one deposit per PaymentIntent, one entry per Stripe refund/dispute
-- movement. These make every writer idempotent.
create unique index ledger_entries_kind_reference on public.ledger_entries (kind, reference);
create index ledger_entries_user_idx on public.ledger_entries (family_user_id, id desc);
create index ledger_entries_facility_idx on public.ledger_entries (facility_id, created_at desc);

create function public.ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger_entries is append-only';
end $$;
create trigger ledger_no_update before update or delete on public.ledger_entries
  for each row execute function public.ledger_immutable();
create trigger ledger_no_truncate before truncate on public.ledger_entries
  for each statement execute function public.ledger_immutable();

alter table public.ledger_entries enable row level security;
create policy ledger_select_family on public.ledger_entries for select to authenticated
  using (family_user_id = auth.uid());
create policy ledger_select_staff on public.ledger_entries for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());
revoke all on public.ledger_entries from anon, authenticated;
grant select on public.ledger_entries to authenticated;

alter publication supabase_realtime add table public.ledger_entries;

-- Visits record what they cost, like messages.fee_cents.
alter table public.visits add column fee_cents int not null default 0 check (fee_cents >= 0);

-- ------------------------------------------------------------------ internal ledger functions
create function public.wallet_balance(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_cents), 0)::bigint from public.ledger_entries where family_user_id = p_user
$$;
revoke execute on function public.wallet_balance(uuid) from public, anon, authenticated;

-- The single writer. Serializes per user so two concurrent charges cannot both spend the same balance.
-- Returns the new entry id, or null if an entry with the same (kind, reference) or Stripe event already exists.
create function public.ledger_post(
  p_user uuid, p_facility uuid, p_kind public.ledger_kind, p_amount int, p_reference text,
  p_refund_of bigint default null, p_stripe_event text default null, p_note text default null,
  p_require_funds boolean default false
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('ledger:' || p_user::text, 0));
  if p_require_funds and public.wallet_balance(p_user) + p_amount < 0 then
    raise exception 'insufficient balance; add funds to continue' using errcode = 'P0001',
      hint = 'insufficient_balance';
  end if;
  insert into public.ledger_entries (family_user_id, facility_id, kind, amount_cents, reference, refund_of, stripe_event_id, note)
  values (p_user, p_facility, p_kind, p_amount, p_reference, p_refund_of, p_stripe_event, p_note)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.log_action(p_facility, 'ledger.' || p_kind::text, 'ledger_entry', v_id::text,
      jsonb_build_object('amount_cents', p_amount, 'reference', p_reference, 'family_user_id', p_user,
                         'refund_of', p_refund_of, 'stripe_event_id', p_stripe_event),
      p_user);
  end if;
  return v_id;
end $$;
revoke execute on function public.ledger_post(uuid, uuid, public.ledger_kind, int, text, bigint, text, text, boolean)
  from public, anon, authenticated;

-- Reverses one entry (a fee being refunded to the wallet). No-op if there is nothing to refund or it was done.
create function public.ledger_refund(p_kind public.ledger_kind, p_reference text, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_orig public.ledger_entries;
begin
  select * into v_orig from public.ledger_entries where kind = p_kind and reference = p_reference;
  if v_orig.id is null then
    return null;
  end if;
  return public.ledger_post(v_orig.family_user_id, v_orig.facility_id, 'refund', -v_orig.amount_cents,
    p_reference, v_orig.id, null, p_note);
end $$;
revoke execute on function public.ledger_refund(public.ledger_kind, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ charging
-- Family messages cost the resident facility's message_fee_cents, after free_messages_per_week (counted per
-- family member per facility, Monday-start weeks in the database time zone, rejected messages not counted).
-- Resident messages are never charged.
create function public.charge_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid;
  v_rate record;
  v_used int;
begin
  new.fee_cents := 0;
  if new.sender <> 'family' then
    return new;
  end if;
  select family_user_id into v_family from public.contacts where id = new.contact_id;
  select * into v_rate from public.rate_card(new.facility_id);
  if coalesce(v_rate.message_fee_cents, 0) = 0 then
    return new;
  end if;
  if v_rate.free_messages_per_week > 0 then
    select count(*) into v_used
      from public.messages m join public.contacts c on c.id = m.contact_id
     where c.family_user_id = v_family and m.facility_id = new.facility_id and m.sender = 'family'
       and m.status <> 'rejected' and m.created_at >= date_trunc('week', now());
    if v_used < v_rate.free_messages_per_week then
      return new;
    end if;
  end if;
  new.fee_cents := v_rate.message_fee_cents;
  perform public.ledger_post(v_family, new.facility_id, 'message_fee', -v_rate.message_fee_cents,
    'message:' || new.id::text, p_require_funds => true);
  return new;
end $$;
create trigger messages_charge before insert on public.messages
  for each row execute function public.charge_message();

create function public.charge_visit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_fee int;
begin
  select visit_fee_cents into v_fee from public.rate_card(new.facility_id);
  new.fee_cents := coalesce(v_fee, 0);
  if new.fee_cents > 0 then
    perform public.ledger_post(new.requested_by, new.facility_id, 'visit_fee', -new.fee_cents,
      'visit:' || new.id::text, p_require_funds => true);
  end if;
  return new;
end $$;
create trigger visits_charge before insert on public.visits
  for each row execute function public.charge_visit();

-- fee_cents is decided at insert and never changes afterwards.
create function public.fee_cents_immutable() returns trigger
language plpgsql as $$
begin
  if new.fee_cents is distinct from old.fee_cents then
    raise exception 'fee_cents cannot change';
  end if;
  return new;
end $$;
create trigger messages_fee_fixed before update of fee_cents on public.messages
  for each row execute function public.fee_cents_immutable();
create trigger visits_fee_fixed before update of fee_cents on public.visits
  for each row execute function public.fee_cents_immutable();

-- ------------------------------------------------------------------ refunds (rules in docs/PAYMENTS.md)
-- A rejected message was never delivered: refund its fee.
create function public.refund_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'rejected' and old.status <> 'rejected' and new.fee_cents > 0 then
    perform public.ledger_refund('message_fee', 'message:' || new.id::text, 'message not delivered');
  end if;
  return null;
end $$;
create trigger messages_refund after update of status on public.messages
  for each row execute function public.refund_message();

-- A visit that never went live is refunded: denied, cancelled by the family or staff, expired without a decision,
-- or approved but nobody joined (no_show). A visit that went live and ended is not refunded.
create function public.refund_visit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fee_cents > 0 and new.status in ('denied', 'cancelled') and old.status not in ('denied', 'cancelled', 'ended') then
    perform public.ledger_refund('visit_fee', 'visit:' || new.id::text,
      case when new.status = 'denied' then 'visit not approved' else 'visit did not take place (' || coalesce(new.end_reason, 'cancelled') || ')' end);
  end if;
  return null;
end $$;
create trigger visits_refund after update of status on public.visits
  for each row execute function public.refund_visit();

revoke execute on function public.charge_message(), public.charge_visit(), public.refund_message(), public.refund_visit()
  from public, anon, authenticated;

-- ------------------------------------------------------------------ family-facing reads
create function public.my_balance() returns bigint
language sql stable security definer set search_path = public as $$
  select public.wallet_balance(auth.uid())
$$;
revoke execute on function public.my_balance() from public, anon;
grant execute on function public.my_balance() to authenticated;

-- Prices that apply to one of the caller's contacts (the resident's facility), and free messages left this week.
-- Families cannot read other facilities' settings, so this exposes only the price fields.
create function public.contact_prices(p_contact uuid)
returns table (message_fee_cents int, visit_fee_cents int, free_messages_left int)
language sql stable security definer set search_path = public as $$
  select r.message_fee_cents, r.visit_fee_cents,
         greatest(r.free_messages_per_week - (
           select count(*)::int from public.messages m join public.contacts c2 on c2.id = m.contact_id
            where c2.family_user_id = auth.uid() and m.facility_id = c.facility_id and m.sender = 'family'
              and m.status <> 'rejected' and m.created_at >= date_trunc('week', now())), 0)
    from public.contacts c, lateral public.rate_card(c.facility_id) r
   where c.id = p_contact and c.family_user_id = auth.uid() and c.status = 'active'
$$;
revoke execute on function public.contact_prices(uuid) from public, anon;
grant execute on function public.contact_prices(uuid) to authenticated;

-- ------------------------------------------------------------------ Stripe (service role only)
-- Called by the verified webhook for a paid Checkout Session. Idempotent on the event id and on the PaymentIntent.
-- Returns 'credited' or 'duplicate'.
create function public.record_deposit(
  p_user uuid, p_facility uuid, p_amount int, p_currency text, p_payment_intent text, p_event text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from public.users where id = p_user and role = 'family') then
    raise exception 'unknown family account' using errcode = '22023';
  end if;
  if not exists (select 1 from public.facilities where id = p_facility) then
    raise exception 'unknown facility' using errcode = '22023';
  end if;
  if p_currency <> 'usd' or p_amount is null or p_amount <= 0 or p_payment_intent !~ '^pi_[A-Za-z0-9_]+$' then
    raise exception 'invalid deposit' using errcode = '22023';
  end if;
  v_id := public.ledger_post(p_user, p_facility, 'deposit', p_amount, p_payment_intent, null, p_event, 'card payment');
  if v_id is null then
    return 'duplicate';
  end if;
  -- Fixed text only: no amounts on lock screens.
  perform public.enqueue_push(p_user, 'Funds added', 'Your Kinline balance was updated.', jsonb_build_object('type', 'wallet'));
  return 'credited';
end $$;
revoke execute on function public.record_deposit(uuid, uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.record_deposit(uuid, uuid, int, text, text, text) to service_role;

-- Money leaving or returning to the wallet because of Stripe: a card refund (debit), a failed card refund (credit),
-- a dispute withdrawal (debit) or a dispute reinstatement (credit). Found through the original deposit's
-- PaymentIntent. The balance may go negative; fees are then blocked until it is topped up.
-- Returns 'recorded', 'duplicate' or 'unknown_payment'.
create function public.record_stripe_reversal(
  p_payment_intent text, p_kind text, p_object_id text, p_amount int, p_event text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_dep public.ledger_entries;
  v_id bigint;
begin
  if p_amount is null or p_amount <= 0 or p_object_id !~ '^(re|du|pyr)_[A-Za-z0-9_]+$' then
    raise exception 'invalid reversal' using errcode = '22023';
  end if;
  select * into v_dep from public.ledger_entries where kind = 'deposit' and reference = p_payment_intent;
  if v_dep.id is null then
    return 'unknown_payment';
  end if;
  v_id := case p_kind
    when 'refund' then public.ledger_post(v_dep.family_user_id, v_dep.facility_id, 'refund', -p_amount,
                         p_object_id, v_dep.id, p_event, 'card refund')
    when 'refund_failed' then public.ledger_post(v_dep.family_user_id, v_dep.facility_id, 'adjustment', p_amount,
                         p_object_id || ':failed', v_dep.id, p_event, 'card refund failed')
    when 'dispute_withdrawn' then public.ledger_post(v_dep.family_user_id, v_dep.facility_id, 'adjustment', -p_amount,
                         p_object_id || ':withdrawn', v_dep.id, p_event, 'card dispute')
    when 'dispute_reinstated' then public.ledger_post(v_dep.family_user_id, v_dep.facility_id, 'adjustment', p_amount,
                         p_object_id || ':reinstated', v_dep.id, p_event, 'card dispute resolved')
  end;
  if p_kind not in ('refund', 'refund_failed', 'dispute_withdrawn', 'dispute_reinstated') then
    raise exception 'unknown reversal kind' using errcode = '22023';
  end if;
  return case when v_id is null then 'duplicate' else 'recorded' end;
end $$;
revoke execute on function public.record_stripe_reversal(text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.record_stripe_reversal(text, text, text, int, text) to service_role;
