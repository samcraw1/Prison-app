-- Family account deletion (Apple guideline 5.1.1(v)). See docs/ACCOUNT_DELETION.md.
-- A family member asks to delete their account; after a 30-day grace period (they can cancel by staying signed in
-- or signing back in) a scheduled job erases their personal data. The public.users row is kept, anonymized, because
-- ledger_entries (financial records) and audit_log point at it. Messages and visits are kept as facility records and
-- show the sender as "Deleted user". Any positive balance is forfeited; the app warns before the request.

alter table public.users
  add column deletion_requested_at timestamptz,
  add column deletion_scheduled_for timestamptz,
  add column erased_at timestamptz,
  add constraint users_deletion_consistent check (
    (deletion_requested_at is null) = (deletion_scheduled_for is null)
  );

create function public.request_account_deletion() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_at timestamptz;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active' and role = 'family' for update;
  if v_user.id is null then
    raise exception 'family account required' using errcode = '42501';
  end if;
  if v_user.deletion_scheduled_for is not null then
    return v_user.deletion_scheduled_for;  -- already requested: do not extend the date
  end if;
  v_at := now() + interval '30 days';
  update public.users set deletion_requested_at = now(), deletion_scheduled_for = v_at where id = v_user.id;
  perform public.log_action(v_user.facility_id, 'account.deletion_requested', 'user', v_user.id::text,
    jsonb_build_object('scheduled_for', v_at), v_user.id);
  return v_at;
end $$;
revoke execute on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;

create function public.cancel_account_deletion() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
begin
  update public.users set deletion_requested_at = null, deletion_scheduled_for = null
   where id = auth.uid() and status = 'active' and role = 'family' and deletion_scheduled_for is not null
  returning * into v_user;
  if v_user.id is not null then
    perform public.log_action(v_user.facility_id, 'account.deletion_cancelled', 'user', v_user.id::text, '{}'::jsonb, v_user.id);
  end if;
end $$;
revoke execute on function public.cancel_account_deletion() from public, anon;
grant execute on function public.cancel_account_deletion() to authenticated;

-- When the caller's deletion will happen, or null.
create function public.my_deletion() returns timestamptz
language sql stable security definer set search_path = public as $$
  select deletion_scheduled_for from public.users where id = auth.uid() and status = 'active'
$$;
revoke execute on function public.my_deletion() from public, anon;
grant execute on function public.my_deletion() to authenticated;

-- Accounts whose grace period has ended (service role; used by the scheduled job).
create function public.accounts_due_for_erasure() returns table (user_id uuid, facility_id uuid)
language sql stable security definer set search_path = public as $$
  select id, facility_id from public.users
   where role = 'family' and status = 'active' and deletion_scheduled_for <= now()
$$;
revoke execute on function public.accounts_due_for_erasure() from public, anon, authenticated;
grant execute on function public.accounts_due_for_erasure() to service_role;

-- Erases personal data in the database. The job removes the ID photos (Storage) and disables the sign-in first,
-- so a failure part-way leaves the account retryable. Ledger rows, audit_log, messages and visits are untouched.
-- Returns 'erased' or 'already_erased'.
create function public.erase_family_account(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
begin
  select * into v_user from public.users where id = p_user and role = 'family' for update;
  if v_user.id is null then
    raise exception 'unknown family account' using errcode = '22023';
  end if;
  if v_user.status = 'deleted' then
    return 'already_erased';
  end if;
  if v_user.deletion_scheduled_for is null or v_user.deletion_scheduled_for > now() then
    raise exception 'deletion is not due' using errcode = 'P0001';
  end if;

  delete from public.push_tokens where user_id = p_user;
  delete from public.roster_lookups where user_id = p_user;
  update public.connection_requests set id_photo_path = 'erased' where family_user_id = p_user;
  update public.contacts set status = 'blocked' where family_user_id = p_user;
  update public.users
     set email = 'deleted+' || p_user::text || '@invalid', full_name = 'Deleted user', phone = null,
         status = 'deleted', erased_at = now()
   where id = p_user;
  perform public.log_action(v_user.facility_id, 'account.erased', 'user', p_user::text, '{}'::jsonb, p_user);
  return 'erased';
end $$;
revoke execute on function public.erase_family_account(uuid) from public, anon, authenticated;
grant execute on function public.erase_family_account(uuid) to service_role;
