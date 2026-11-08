-- The app's name is SecureVisit (App Store Connect). 20261108000009 briefly used "ClearLine" in the "funds added"
-- push text; re-create the function with the correct name. Nothing else in the database carries the app name.
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
  perform public.enqueue_push(p_user, 'Funds added', 'Your SecureVisit balance was updated.', jsonb_build_object('type', 'wallet'));
  return 'credited';
end $$;
revoke execute on function public.record_deposit(uuid, uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.record_deposit(uuid, uuid, int, text, text, text) to service_role;
