-- Step 1: facilities, users, residents, audit log, RLS helpers.

create type public.user_role as enum ('family', 'resident', 'staff', 'admin');
create type public.user_status as enum ('active', 'suspended');

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  settings jsonb not null default jsonb_build_object(
    'hold_all_messages', true,
    'max_visit_minutes', 30,
    'max_visits_per_week', 2
  ),
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  facility_id uuid not null references public.facilities (id),
  role public.user_role not null,
  email text not null,
  phone text,
  full_name text not null,
  status public.user_status not null default 'active',
  created_at timestamptz not null default now()
);
create index users_facility_idx on public.users (facility_id, role);

create table public.residents (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  user_id uuid not null unique references public.users (id) on delete cascade,
  booking_number text not null check (booking_number ~ '^[A-Za-z0-9-]{3,20}$'),
  full_name text not null,
  housing_unit text,
  comms_suspended boolean not null default false,
  pin_failures int not null default 0,
  must_change_pin boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, booking_number)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  facility_id uuid not null references public.facilities (id),
  actor_id uuid,
  actor_role public.user_role,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_facility_idx on public.audit_log (facility_id, created_at desc);

-- ---------------------------------------------------------------- helpers
create function public.auth_facility() returns uuid
language sql stable security definer set search_path = public as
$$ select facility_id from public.users where id = auth.uid() and status = 'active' $$;

create function public.auth_role() returns public.user_role
language sql stable security definer set search_path = public as
$$ select role from public.users where id = auth.uid() and status = 'active' $$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.auth_role() in ('staff', 'admin'), false) $$;

-- Only callable from other security-definer code (triggers) and service_role.
create function public.log_action(
  p_facility uuid, p_action text, p_entity text, p_entity_id text,
  p_detail jsonb default '{}'::jsonb, p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := coalesce(auth.uid(), p_actor);
begin
  insert into public.audit_log (facility_id, actor_id, actor_role, action, entity, entity_id, detail)
  values (
    p_facility, v_actor,
    (select role from public.users where id = v_actor),
    p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb)
  );
end $$;

revoke execute on function public.log_action(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.auth_facility(), public.auth_role(), public.is_staff() from public, anon;
grant execute on function public.auth_facility(), public.auth_role(), public.is_staff() to authenticated;

-- ----------------------------------------------------- audit immutability
create function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

-- ------------------------------------------------------------------- RLS
alter table public.facilities enable row level security;
alter table public.users enable row level security;
alter table public.residents enable row level security;
alter table public.audit_log enable row level security;

-- Writes to these tables happen through service-role route handlers only.
create policy facilities_select on public.facilities for select to authenticated
  using (id = public.auth_facility());
create policy facilities_update_admin on public.facilities for update to authenticated
  using (id = public.auth_facility() and public.auth_role() = 'admin')
  with check (id = public.auth_facility());

create policy users_select_self on public.users for select to authenticated
  using (id = auth.uid());
create policy users_select_staff on public.users for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

create policy residents_select_self on public.residents for select to authenticated
  using (user_id = auth.uid());
create policy residents_select_staff on public.residents for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());
create policy residents_update_staff on public.residents for update to authenticated
  using (public.is_staff() and facility_id = public.auth_facility())
  with check (facility_id = public.auth_facility());

create policy audit_select_staff on public.audit_log for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

-- Column-level lockdown: authenticated clients never insert/delete these tables
-- and can only update the few fields staff manage.
revoke all on public.facilities, public.users, public.residents, public.audit_log from anon, authenticated;
grant select on public.facilities, public.users, public.residents, public.audit_log to authenticated;
grant update (settings, name) on public.facilities to authenticated;
grant update (comms_suspended, housing_unit) on public.residents to authenticated;

-- ----------------------------------------------- audit triggers (step 1)
create function public.audit_resident_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.comms_suspended is distinct from old.comms_suspended then
    perform public.log_action(
      new.facility_id,
      case when new.comms_suspended then 'resident.suspend' else 'resident.unsuspend' end,
      'resident', new.id::text,
      jsonb_build_object('booking_number', new.booking_number)
    );
  end if;
  return new;
end $$;
create trigger residents_audit after update on public.residents
  for each row execute function public.audit_resident_change();

create function public.audit_facility_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.settings is distinct from old.settings then
    perform public.log_action(new.id, 'facility.settings_update', 'facility', new.id::text,
      jsonb_build_object('old', old.settings, 'new', new.settings));
  end if;
  return new;
end $$;
create trigger facilities_audit after update on public.facilities
  for each row execute function public.audit_facility_change();
