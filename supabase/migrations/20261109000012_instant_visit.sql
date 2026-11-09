-- "Call now": an on-demand visit. It creates a short slot that starts in a few minutes and a normal visit request
-- for it, so everything downstream is unchanged: staff approve it (and can watch or end it), the fee trigger charges
-- it like any visit, the join window opens 5 minutes before the start, and the family member is notified on approval.
-- Unapproved requests expire when the start time passes (expire_visits).

create function public.request_instant_visit(p_contact uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_contact public.contacts;
  v_resident public.residents;
  v_slot uuid;
  v_start timestamptz := date_trunc('minute', now()) + interval '10 minutes';
  v_max int;
  v_id uuid;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or v_user.role <> 'family' then
    raise exception 'only family accounts can request visits' using errcode = '42501';
  end if;
  select * into v_contact from public.contacts
   where id = p_contact and family_user_id = v_user.id and status = 'active' and family_blocked_at is null;
  if v_contact.id is null then
    raise exception 'unknown contact' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v_contact.resident_id;
  if v_resident.comms_suspended then
    raise exception 'visits are currently unavailable' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.visits v join public.visit_slots s on s.id = v.slot_id
              where v.contact_id = v_contact.id and v.status in ('requested', 'approved', 'live')
                and s.ends_at > now() and s.starts_at < now() + interval '30 minutes') then
    raise exception 'you already have a visit starting soon' using errcode = 'P0001';
  end if;
  select (settings->>'max_visits_per_week')::int into v_max from public.facilities where id = v_contact.facility_id;
  if public.resident_visits_in_week(v_resident.id, v_start) >= v_max then
    raise exception 'weekly visit limit reached' using errcode = 'P0001';
  end if;

  insert into public.visit_slots (facility_id, starts_at, ends_at, capacity)
  values (v_contact.facility_id, v_start, v_start + interval '20 minutes', 1) returning id into v_slot;
  insert into public.visits (facility_id, contact_id, slot_id, requested_by)
  values (v_contact.facility_id, v_contact.id, v_slot, v_user.id) returning id into v_id;
  perform public.log_action(v_contact.facility_id, 'visit.request', 'visit', v_id::text,
    jsonb_build_object('slot_id', v_slot, 'instant', true));
  return v_id;
end $$;

revoke execute on function public.request_instant_visit(uuid) from public, anon;
grant execute on function public.request_instant_visit(uuid) to authenticated;
