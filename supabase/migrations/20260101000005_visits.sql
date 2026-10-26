-- Step 5: scheduled video visits. Only metadata is stored; video itself lives with the hosted provider.

create type public.visit_status as enum ('requested', 'approved', 'denied', 'live', 'ended', 'cancelled');

create table public.visit_slots (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null default 1 check (capacity between 1 and 20),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index visit_slots_facility_idx on public.visit_slots (facility_id, starts_at);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  slot_id uuid not null references public.visit_slots (id),
  status public.visit_status not null default 'requested',
  requested_by uuid not null references public.users (id),
  decided_by uuid references public.users (id),
  decided_at timestamptz,
  deny_reason text check (deny_reason is null or char_length(deny_reason) <= 300),
  daily_room text,                       -- provider room name, set when the first person joins
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.users (id),   -- staff member who ended it; null when it ended on its own
  end_reason text check (end_reason in ('staff', 'time', 'cancelled', 'no_show', 'expired')),
  -- Recording is out of scope for the MVP. A production version would enable provider-side recording
  -- when the room is created (src/lib/video) and store the retained asset reference here.
  recording_url text,
  created_at timestamptz not null default now()
);
create index visits_queue_idx on public.visits (facility_id, status);
create index visits_slot_idx on public.visits (slot_id);
create index visits_contact_idx on public.visits (contact_id);

alter table public.visit_slots enable row level security;
alter table public.visits enable row level security;

create policy slots_select_facility on public.visit_slots for select to authenticated
  using (facility_id = public.auth_facility());

create policy visits_select_family on public.visits for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = visits.contact_id and c.family_user_id = auth.uid() and c.status = 'active'));
create policy visits_select_resident on public.visits for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = visits.contact_id and c.resident_id = public.my_resident_id() and c.status = 'active'));
create policy visits_select_staff on public.visits for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

revoke all on public.visit_slots, public.visits from anon, authenticated;
grant select on public.visit_slots, public.visits to authenticated;

-- Number of visits that count toward a resident's weekly limit, in the week containing p_when.
create function public.resident_visits_in_week(p_resident uuid, p_when timestamptz, p_exclude uuid default null)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from public.visits v
    join public.contacts c on c.id = v.contact_id
    join public.visit_slots s on s.id = v.slot_id
   where c.resident_id = p_resident
     and v.status in ('requested', 'approved', 'live', 'ended')
     and (p_exclude is null or v.id <> p_exclude)
     and date_trunc('week', s.starts_at) = date_trunc('week', p_when)
$$;

create function public.slot_booked(p_slot uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.visits where slot_id = p_slot and status in ('requested', 'approved', 'live')
$$;

revoke execute on function public.resident_visits_in_week(uuid, timestamptz, uuid), public.slot_booked(uuid) from public, anon, authenticated;

-- Opportunistic cleanup (no scheduler in the MVP): anything whose slot is over gets closed out.
create function public.expire_visits() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.visits v set status = 'ended', ended_at = s.ends_at, end_reason = 'time'
    from public.visit_slots s where s.id = v.slot_id and v.status = 'live' and s.ends_at < now();
  update public.visits v set status = 'cancelled', end_reason = 'no_show'
    from public.visit_slots s where s.id = v.slot_id and v.status = 'approved' and s.ends_at < now();
  update public.visits v set status = 'cancelled', end_reason = 'expired'
    from public.visit_slots s where s.id = v.slot_id and v.status = 'requested' and s.starts_at < now();
end $$;
revoke execute on function public.expire_visits() from public, anon;
grant execute on function public.expire_visits() to authenticated, service_role;

create function public.list_open_slots()
returns table (slot_id uuid, starts_at timestamptz, ends_at timestamptz, remaining int)
language sql stable security definer set search_path = public as $$
  select s.id, s.starts_at, s.ends_at, s.capacity - public.slot_booked(s.id)
    from public.visit_slots s
   where s.facility_id = public.auth_facility() and s.starts_at > now()
     and s.capacity - public.slot_booked(s.id) > 0
   order by s.starts_at
$$;

create function public.request_visit(p_contact uuid, p_slot uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_contact public.contacts;
  v_resident public.residents;
  v_slot public.visit_slots;
  v_max int;
  v_id uuid;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or v_user.role <> 'family' then
    raise exception 'only family accounts can request visits' using errcode = '42501';
  end if;
  select * into v_contact from public.contacts where id = p_contact and family_user_id = v_user.id and status = 'active';
  if v_contact.id is null then
    raise exception 'unknown contact' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v_contact.resident_id;
  if v_resident.comms_suspended then
    raise exception 'visits are currently unavailable' using errcode = 'P0001';
  end if;
  select * into v_slot from public.visit_slots where id = p_slot and facility_id = v_user.facility_id;
  if v_slot.id is null or v_slot.starts_at <= now() then
    raise exception 'that time is not available' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.visits where contact_id = v_contact.id and slot_id = v_slot.id and status in ('requested', 'approved', 'live')) then
    raise exception 'you already requested this time' using errcode = 'P0001';
  end if;
  -- serialize concurrent requests for the same slot
  perform 1 from public.visit_slots where id = v_slot.id for update;
  if public.slot_booked(v_slot.id) >= v_slot.capacity then
    raise exception 'that time is full' using errcode = 'P0001';
  end if;
  select (settings->>'max_visits_per_week')::int into v_max from public.facilities where id = v_user.facility_id;
  if public.resident_visits_in_week(v_resident.id, v_slot.starts_at) >= v_max then
    raise exception 'weekly visit limit reached' using errcode = 'P0001';
  end if;

  insert into public.visits (facility_id, contact_id, slot_id, requested_by)
  values (v_user.facility_id, v_contact.id, v_slot.id, v_user.id) returning id into v_id;
  perform public.log_action(v_user.facility_id, 'visit.request', 'visit', v_id::text, jsonb_build_object('slot_id', v_slot.id));
  return v_id;
end $$;

create function public.decide_visit(p_visit uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_visit public.visits;
  v_slot public.visit_slots;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into v_visit from public.visits where id = p_visit and facility_id = public.auth_facility() for update;
  if v_visit.id is null then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  if v_visit.status <> 'requested' then
    raise exception 'visit already decided' using errcode = 'P0001';
  end if;
  select * into v_slot from public.visit_slots where id = v_visit.slot_id;
  if p_approve and v_slot.ends_at <= now() then
    raise exception 'that time has passed' using errcode = 'P0001';
  end if;
  if p_approve and exists (select 1 from public.contacts c join public.residents r on r.id = c.resident_id
                            where c.id = v_visit.contact_id and (r.comms_suspended or c.status <> 'active')) then
    raise exception 'resident or contact is restricted' using errcode = 'P0001';
  end if;

  update public.visits
     set status = case when p_approve then 'approved'::public.visit_status else 'denied'::public.visit_status end,
         decided_by = auth.uid(), decided_at = now(),
         deny_reason = case when p_approve then null else left(p_reason, 300) end
   where id = v_visit.id;
  perform public.log_action(v_visit.facility_id, case when p_approve then 'visit.approve' else 'visit.deny' end,
    'visit', v_visit.id::text, jsonb_build_object('reason', left(p_reason, 300)));
end $$;

create function public.cancel_visit(p_visit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_visit public.visits;
begin
  select v.* into v_visit from public.visits v
    join public.contacts c on c.id = v.contact_id
   where v.id = p_visit and v.status in ('requested', 'approved')
     and ((c.family_user_id = auth.uid()) or (public.is_staff() and v.facility_id = public.auth_facility()))
   for update of v;
  if v_visit.id is null then
    raise exception 'visit not found' using errcode = 'P0002';
  end if;
  update public.visits set status = 'cancelled', end_reason = 'cancelled' where id = v_visit.id;
  perform public.log_action(v_visit.facility_id, 'visit.cancel', 'visit', v_visit.id::text, '{}'::jsonb);
end $$;

create function public.end_visit(p_visit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_visit public.visits;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  update public.visits set status = 'ended', ended_at = now(), ended_by = auth.uid(), end_reason = 'staff'
   where id = p_visit and facility_id = public.auth_facility() and status = 'live'
  returning * into v_visit;
  if v_visit.id is null then
    raise exception 'visit is not live' using errcode = 'P0001';
  end if;
  perform public.log_action(v_visit.facility_id, 'visit.end', 'visit', v_visit.id::text, '{}'::jsonb);
end $$;

create function public.create_slot(p_starts timestamptz, p_minutes int, p_capacity int default 1) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select (settings->>'max_visit_minutes')::int into v_max from public.facilities where id = public.auth_facility();
  if p_minutes < 5 or p_minutes > v_max then
    raise exception 'visit length must be between 5 and % minutes', v_max using errcode = '22023';
  end if;
  if p_starts <= now() then
    raise exception 'slots must start in the future' using errcode = '22023';
  end if;
  insert into public.visit_slots (facility_id, starts_at, ends_at, capacity, created_by)
  values (public.auth_facility(), p_starts, p_starts + make_interval(mins => p_minutes), p_capacity, auth.uid())
  returning id into v_id;
  perform public.log_action(public.auth_facility(), 'slot.create', 'visit_slot', v_id::text,
    jsonb_build_object('starts_at', p_starts, 'minutes', p_minutes, 'capacity', p_capacity));
  return v_id;
end $$;

create function public.delete_slot(p_slot uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_slot public.visit_slots;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into v_slot from public.visit_slots where id = p_slot and facility_id = public.auth_facility();
  if v_slot.id is null then
    raise exception 'slot not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.visits where slot_id = p_slot and status in ('requested', 'approved', 'live')) then
    raise exception 'cancel or decide the visits for this slot first' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.visits where slot_id = p_slot) then
    raise exception 'this slot has visit history and cannot be deleted' using errcode = 'P0001';
  end if;
  delete from public.visit_slots where id = p_slot;
  perform public.log_action(v_slot.facility_id, 'slot.delete', 'visit_slot', p_slot::text,
    jsonb_build_object('starts_at', v_slot.starts_at));
end $$;

revoke execute on function public.list_open_slots(), public.request_visit(uuid, uuid), public.decide_visit(uuid, boolean, text),
  public.cancel_visit(uuid), public.end_visit(uuid), public.create_slot(timestamptz, int, int), public.delete_slot(uuid)
  from public, anon;
grant execute on function public.list_open_slots(), public.request_visit(uuid, uuid), public.decide_visit(uuid, boolean, text),
  public.cancel_visit(uuid), public.end_visit(uuid), public.create_slot(timestamptz, int, int), public.delete_slot(uuid)
  to authenticated;
