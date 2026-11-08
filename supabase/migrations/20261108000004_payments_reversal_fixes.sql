-- Payments hardening for Stripe reversals (follow-up to 20261108000003_payments.sql).
--  1. Accept current Stripe dispute ids (dp_) as well as legacy du_ / refund re_ / pyr_ ids. A rejected id raised
--     inside the webhook, so Stripe retried a real dispute forever without ever recording it.
--  2. A credit that undoes a Stripe debit (refund_failed, dispute_reinstated) is only posted when the debit it undoes
--     was recorded. Otherwise the wallet would gain money that never left. The function raises so the webhook returns
--     500 and Stripe retries later, which also covers events delivered out of order.

create or replace function public.record_stripe_reversal(
  p_payment_intent text, p_kind text, p_object_id text, p_amount int, p_event text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_dep public.ledger_entries;
  v_id bigint;
begin
  if p_kind not in ('refund', 'refund_failed', 'dispute_withdrawn', 'dispute_reinstated') then
    raise exception 'unknown reversal kind' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_object_id !~ '^(re|du|dp|pyr)_[A-Za-z0-9_]+$' then
    raise exception 'invalid reversal' using errcode = '22023';
  end if;
  select * into v_dep from public.ledger_entries where kind = 'deposit' and reference = p_payment_intent;
  if v_dep.id is null then
    return 'unknown_payment';
  end if;

  -- The debit this event undoes must already be in the ledger.
  if p_kind = 'refund_failed' and not exists (
       select 1 from public.ledger_entries where kind = 'refund' and reference = p_object_id) then
    raise exception 'refund % not recorded yet', p_object_id using errcode = 'P0001', hint = 'retry_later';
  end if;
  if p_kind = 'dispute_reinstated' and not exists (
       select 1 from public.ledger_entries where kind = 'adjustment' and reference = p_object_id || ':withdrawn') then
    raise exception 'dispute % withdrawal not recorded yet', p_object_id using errcode = 'P0001', hint = 'retry_later';
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
  return case when v_id is null then 'duplicate' else 'recorded' end;
end $$;
revoke execute on function public.record_stripe_reversal(text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.record_stripe_reversal(text, text, text, int, text) to service_role;
