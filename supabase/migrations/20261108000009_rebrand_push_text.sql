-- The app was renamed Kinline -> ClearLine. Only one database function carried the old name (the "funds added"
-- push text in 20261108000003_payments.sql, already applied), so it is re-created here with the new name.
create or replace function public.record_deposit(
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
  perform public.enqueue_push(p_user, 'Funds added', 'Your ClearLine balance was updated.', jsonb_build_object('type', 'wallet'));
  return 'credited';
end $$;
revoke execute on function public.record_deposit(uuid, uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.record_deposit(uuid, uuid, int, text, text, text) to service_role;
