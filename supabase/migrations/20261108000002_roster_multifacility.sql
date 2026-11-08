-- Resident roster + multi-facility family connections.
--
-- * public.residents IS the roster (one row per person per facility). It gains custody status, admission date,
--   a stable source identifier and sync timestamps instead of a parallel table, so existing contacts, messages,
--   visits and audit history keep pointing at the same rows.
-- * Families can connect with residents at any listed facility. Requests, ID photos, messages and visits follow the
--   resident's facility, so that facility's staff review them. A family account still has a home facility.
-- * Families never read the roster. They verify one (facility, name, booking number) at a time through a
--   rate-limited function that answers only "matched / not matched".
-- * Roster imports (future daily job) stage rows in roster_sync_rows and apply them with apply_roster_sync(),
--   which upserts by stable identifiers and never deletes.

-- ------------------------------------------------------------------ roster columns
create type public.custody_status as enum ('active', 'released', 'transferred');

alter table public.residents
  add column custody_status public.custody_status not null default 'active',
  add column admission_date date,
  add column external_id text check (external_id is null or char_length(external_id) between 1 and 100),
  add column roster_source text not null default 'manual' check (roster_source in ('manual', 'sync')),
  add column last_synced_at timestamptz,
  add column missing_from_roster_since timestamptz,
  add column custody_changed_at timestamptz,
  add column updated_at timestamptz not null default now();

-- Stable identity for imports: the facility's own system id when it has one, otherwise the booking number
-- (already unique per facility).
create unique index residents_facility_external_id on public.residents (facility_id, external_id) where external_id is not null;
create index residents_facility_custody on public.residents (facility_id, custody_status);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger residents_touch before update on public.residents for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ facilities
alter table public.facilities
  add column listed boolean not null default true,            -- shown in the family "Connect" facility picker
  add column roster_source text check (roster_source in ('manual', 'api', 'csv', 'sftp', 'other')),
  add column roster_config jsonb not null default '{}'::jsonb; -- non-secret import settings; secrets live in Vault/env

-- Names of facilities a family can choose from. Facility names are public; nothing else is returned.
create function public.list_connect_facilities()
returns table (id uuid, name text, slug text)
language sql stable security definer set search_path = public as $$
  select f.id, f.name, f.slug from public.facilities f
   where f.listed or f.id = public.auth_facility()
   order by f.name
$$;
revoke execute on function public.list_connect_facilities() from public, anon;
grant execute on function public.list_connect_facilities() to authenticated;

-- ------------------------------------------------------------------ matching
create function public.normalize_person_name(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:][:space:]]', '', 'g'), '\s+', ' ', 'g'))
$$;

create index residents_match_idx on public.residents (facility_id, upper(booking_number));

-- Active resident with exactly this booking number and name at this facility, or null.
create function public.match_roster_resident(p_facility uuid, p_name text, p_booking text) returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.residents r
   where r.facility_id = p_facility
     and upper(r.booking_number) = upper(btrim(p_booking))
     and r.custody_status = 'active'
     and public.normalize_person_name(r.full_name) = public.normalize_person_name(p_name)
   limit 1
$$;
revoke execute on function public.match_roster_resident(uuid, text, text) from public, anon, authenticated;

-- Every family lookup (verify or request) is recorded without the typed name or booking number.
create table public.roster_lookups (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  facility_id uuid not null references public.facilities (id),
  matched boolean not null,
  created_at timestamptz not null default now()
);
create index roster_lookups_user_idx on public.roster_lookups (user_id, created_at desc);
alter table public.roster_lookups enable row level security; -- no policies: internal only
revoke all on public.roster_lookups from anon, authenticated;

-- Limits make enumerating the roster impractical: 5 unmatched lookups per hour and 20 lookups per day per account.
create function public.roster_lookup_guard(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.roster_lookups where user_id = p_user and not matched and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.roster_lookups where user_id = p_user and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too many lookups; please try again later' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function public.roster_lookup_guard(uuid) from public, anon, authenticated;

-- Family-facing check. Returns only whether an active resident matches; never names, ids or housing.
create function public.verify_resident(p_facility uuid, p_resident_name text, p_booking text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_match uuid;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or v_user.role <> 'family' then
    raise exception 'only family accounts can look up residents' using errcode = '42501';
  end if;
  if not exists (select 1 from public.facilities where id = p_facility and (listed or id = v_user.facility_id)) then
    raise exception 'unknown facility' using errcode = '22023';
  end if;
  if btrim(coalesce(p_booking, '')) !~ '^[A-Za-z0-9-]{3,20}$' or char_length(public.normalize_person_name(p_resident_name)) < 2 then
    raise exception 'enter the full name and booking number' using errcode = '22023';
  end if;
  perform public.roster_lookup_guard(v_user.id);

  v_match := public.match_roster_resident(p_facility, p_resident_name, p_booking);
  insert into public.roster_lookups (user_id, facility_id, matched) values (v_user.id, p_facility, v_match is not null);
  return v_match is not null;
end $$;
revoke execute on function public.verify_resident(uuid, text, text) from public, anon;
grant execute on function public.verify_resident(uuid, text, text) to authenticated;

-- ------------------------------------------------------------------ connection requests
-- Cross-facility request. The request (and its ID photo) belongs to the resident's facility, so that facility's
-- staff review it. Unmatched requests are allowed so staff can verify manually (link_request_resident).
create function public.request_connection(
  p_facility uuid, p_resident_name text, p_booking text, p_relationship text, p_id_photo_path text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_resident uuid;
  v_id uuid;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or v_user.role <> 'family' then
    raise exception 'only family accounts can request a connection' using errcode = '42501';
  end if;
  if not exists (select 1 from public.facilities where id = p_facility and (listed or id = v_user.facility_id)) then
    raise exception 'unknown facility' using errcode = '22023';
  end if;
  if p_id_photo_path is null or p_id_photo_path not like (p_facility::text || '/' || v_user.id::text || '/%')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'id-photos' and o.name = p_id_photo_path) then
    raise exception 'invalid ID photo path' using errcode = '22023';
  end if;
  perform public.roster_lookup_guard(v_user.id);

  v_resident := public.match_roster_resident(p_facility, p_resident_name, p_booking);
  insert into public.roster_lookups (user_id, facility_id, matched) values (v_user.id, p_facility, v_resident is not null);

  insert into public.connection_requests
    (facility_id, family_user_id, resident_id, typed_resident_name, typed_booking_number, relationship, id_photo_path)
  values
    (p_facility, v_user.id, v_resident, btrim(p_resident_name), btrim(p_booking), btrim(p_relationship), p_id_photo_path)
  returning id into v_id;

  perform public.log_action(p_facility, 'connection.request', 'connection_request', v_id::text,
    jsonb_build_object('matched', v_resident is not null, 'home_facility', v_user.facility_id));
  return v_id;
end $$;
revoke execute on function public.request_connection(uuid, text, text, text, text) from public, anon;
grant execute on function public.request_connection(uuid, text, text, text, text) to authenticated;

-- The original 4-argument version (used by the website) now means "at my home facility".
create or replace function public.request_connection(
  p_resident_name text, p_booking text, p_relationship text, p_id_photo_path text
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  return public.request_connection(public.auth_facility(), p_resident_name, p_booking, p_relationship, p_id_photo_path);
end $$;

-- Staff-assisted verification: attach an unmatched pending request to an active resident of the staff member's
-- facility, after checking the details themselves. Approval is still a separate step.
create function public.link_request_resident(p_request uuid, p_resident uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.connection_requests;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into v_req from public.connection_requests
   where id = p_request and facility_id = public.auth_facility() and status = 'pending' for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.residents where id = p_resident and facility_id = v_req.facility_id and custody_status = 'active') then
    raise exception 'resident not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.connection_requests
              where family_user_id = v_req.family_user_id and resident_id = p_resident and status = 'pending' and id <> v_req.id) then
    raise exception 'this person already has a pending request for that resident; decide that one instead' using errcode = 'P0001';
  end if;
  update public.connection_requests set resident_id = p_resident where id = v_req.id;
  perform public.log_action(v_req.facility_id, 'connection.link_resident', 'connection_request', v_req.id::text,
    jsonb_build_object('resident_id', p_resident, 'previous_resident_id', v_req.resident_id));
end $$;
revoke execute on function public.link_request_resident(uuid, uuid) from public, anon;
grant execute on function public.link_request_resident(uuid, uuid) to authenticated;

-- Approval now also requires the resident to still be in custody here.
create or replace function public.decide_connection(p_request uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.connection_requests;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into v_req from public.connection_requests
   where id = p_request and facility_id = public.auth_facility() for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'request already decided' using errcode = 'P0001';
  end if;

  if p_approve then
    if v_req.resident_id is null then
      raise exception 'no matching resident; link a resident or deny' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.residents where id = v_req.resident_id and custody_status = 'active') then
      raise exception 'resident is no longer in custody here; deny instead' using errcode = 'P0001';
    end if;
    insert into public.contacts (facility_id, resident_id, family_user_id, relationship, request_id)
    values (v_req.facility_id, v_req.resident_id, v_req.family_user_id, v_req.relationship, v_req.id)
    on conflict (resident_id, family_user_id) do nothing;
  end if;

  update public.connection_requests
     set status = case when p_approve then 'approved'::public.request_status else 'denied'::public.request_status end,
         decided_by = auth.uid(), decided_at = now(),
         deny_reason = case when p_approve then null else left(p_reason, 300) end
   where id = v_req.id;

  perform public.log_action(v_req.facility_id,
    case when p_approve then 'connection.approve' else 'connection.deny' end,
    'connection_request', v_req.id::text,
    jsonb_build_object('resident_id', v_req.resident_id, 'family_user_id', v_req.family_user_id, 'reason', left(p_reason, 300)));
end $$;

-- ID photos are stored under the facility that will review them: {facility}/{family user}/{file}.
-- (Security definer: families can't read other facilities' rows, but may upload for any listed facility.)
create function public.is_connectable_facility(p_facility text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.facilities f where f.id::text = p_facility and (f.listed or f.id = public.auth_facility()))
$$;
revoke execute on function public.is_connectable_facility(text) from public, anon;
grant execute on function public.is_connectable_facility(text) to authenticated;

drop policy id_photos_insert_family on storage.objects;
create policy id_photos_insert_family on storage.objects for insert to authenticated
  with check (
    bucket_id = 'id-photos'
    and public.auth_role() = 'family'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_connectable_facility((storage.foldername(name))[1])
  );

-- ------------------------------------------------------------------ cross-facility messaging and visits
-- A family member's contacts can be at other facilities: messages and visits take the contact's facility.

create or replace function public.send_message(p_contact uuid, p_body text, p_attachment_path text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_contact public.contacts;
  v_resident public.residents;
  v_sender public.sender_type;
  v_body text := btrim(p_body);
  v_hold boolean;
  v_matches text[];
  v_status public.message_status;
  v_id uuid;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or v_user.role not in ('family', 'resident') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 2000 then
    raise exception 'message must be 1-2000 characters' using errcode = '22023';
  end if;

  select * into v_contact from public.contacts where id = p_contact and status = 'active';
  if v_contact.id is null then
    raise exception 'unknown contact' using errcode = '42501';
  end if;
  select * into v_resident from public.residents where id = v_contact.resident_id;

  if v_user.role = 'family' then
    if v_contact.family_user_id is distinct from v_user.id then
      raise exception 'unknown contact' using errcode = '42501';
    end if;
    v_sender := 'family';
  else
    if v_resident.user_id is distinct from v_user.id then
      raise exception 'unknown contact' using errcode = '42501';
    end if;
    v_sender := 'resident';
  end if;
  if v_resident.comms_suspended then
    raise exception 'communication is currently unavailable' using errcode = 'P0001';
  end if;

  if p_attachment_path is not null then
    if v_sender <> 'family' then
      raise exception 'residents cannot send attachments' using errcode = '42501';
    end if;
    -- Uploaded under the sender's home facility (unchanged storage layout); staff see it through the message.
    if p_attachment_path not like (v_user.facility_id::text || '/' || v_user.id::text || '/%')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'message-attachments' and o.name = p_attachment_path)
       or exists (select 1 from public.messages m where m.attachment_path = p_attachment_path) then
      raise exception 'invalid attachment' using errcode = '22023';
    end if;
  end if;

  if (select count(*) from public.messages
       where contact_id = v_contact.id and sender = v_sender and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many messages; try again later' using errcode = 'P0001';
  end if;

  -- The resident's facility decides review rules and keywords.
  select coalesce((settings->>'hold_all_messages')::boolean, true) into v_hold
    from public.facilities where id = v_contact.facility_id;

  select coalesce(array_agg(k.word order by k.word), '{}') into v_matches
    from public.flag_keywords k
   where k.facility_id = v_contact.facility_id
     and v_body ~* ('\y' || regexp_replace(k.word, '([.\\+*?\[^\]$(){}=!<>|:-])', '\\\1', 'g') || '\y');

  v_status := case when array_length(v_matches, 1) > 0 or v_hold then 'held' else 'delivered' end;

  insert into public.messages (facility_id, contact_id, sender, body, attachment_path, status, flagged, flag_reasons, delivered_at)
  values (v_contact.facility_id, v_contact.id, v_sender, v_body, p_attachment_path, v_status,
          coalesce(array_length(v_matches, 1), 0) > 0, v_matches,
          case when v_status = 'delivered' then now() end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.request_visit(p_contact uuid, p_slot uuid) returns uuid
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
  select * into v_slot from public.visit_slots where id = p_slot and facility_id = v_contact.facility_id;
  if v_slot.id is null or v_slot.starts_at <= now() then
    raise exception 'that time is not available' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.visits where contact_id = v_contact.id and slot_id = v_slot.id and status in ('requested', 'approved', 'live')) then
    raise exception 'you already requested this time' using errcode = 'P0001';
  end if;
  perform 1 from public.visit_slots where id = v_slot.id for update;
  if public.slot_booked(v_slot.id) >= v_slot.capacity then
    raise exception 'that time is full' using errcode = 'P0001';
  end if;
  select (settings->>'max_visits_per_week')::int into v_max from public.facilities where id = v_contact.facility_id;
  if public.resident_visits_in_week(v_resident.id, v_slot.starts_at) >= v_max then
    raise exception 'weekly visit limit reached' using errcode = 'P0001';
  end if;

  insert into public.visits (facility_id, contact_id, slot_id, requested_by)
  values (v_contact.facility_id, v_contact.id, v_slot.id, v_user.id) returning id into v_id;
  perform public.log_action(v_contact.facility_id, 'visit.request', 'visit', v_id::text, jsonb_build_object('slot_id', v_slot.id));
  return v_id;
end $$;

-- Open slots. Staff/residents: their facility (unchanged). Families: facilities where they have an active contact.
create or replace function public.list_open_slots()
returns table (slot_id uuid, starts_at timestamptz, ends_at timestamptz, remaining int)
language sql stable security definer set search_path = public as $$
  select s.id, s.starts_at, s.ends_at, s.capacity - public.slot_booked(s.id)
    from public.visit_slots s
   where s.starts_at > now()
     and s.capacity - public.slot_booked(s.id) > 0
     and (case when public.auth_role() = 'family'
               then exists (select 1 from public.contacts c where c.family_user_id = auth.uid() and c.status = 'active' and c.facility_id = s.facility_id)
               else s.facility_id = public.auth_facility() end)
   order by s.starts_at
$$;

-- Open slots for one contact's facility (the app's visit request form).
create function public.list_open_slots_for_contact(p_contact uuid)
returns table (slot_id uuid, starts_at timestamptz, ends_at timestamptz, remaining int)
language sql stable security definer set search_path = public as $$
  select s.id, s.starts_at, s.ends_at, s.capacity - public.slot_booked(s.id)
    from public.visit_slots s
    join public.contacts c on c.facility_id = s.facility_id
   where c.id = p_contact and c.family_user_id = auth.uid() and c.status = 'active'
     and s.starts_at > now() and s.capacity - public.slot_booked(s.id) > 0
   order by s.starts_at
$$;
revoke execute on function public.list_open_slots_for_contact(uuid) from public, anon;
grant execute on function public.list_open_slots_for_contact(uuid) to authenticated;

-- Families can read slot times of facilities where they have an active contact (for their visits list).
create policy slots_select_family_contacts on public.visit_slots for select to authenticated
  using (exists (select 1 from public.contacts c
                  where c.family_user_id = auth.uid() and c.status = 'active' and c.facility_id = visit_slots.facility_id));

-- ------------------------------------------------------------------ roster sync scaffolding (no scheduler yet)
create type public.roster_run_status as enum ('running', 'succeeded', 'partial', 'failed');

create table public.roster_sync_runs (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  source text not null,                       -- e.g. 'api', 'csv', 'sftp'
  is_complete_snapshot boolean not null,      -- false for incremental/delta feeds
  status public.roster_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_received int not null default 0,
  rows_updated int not null default 0,
  rows_new int not null default 0,            -- admissions that still need a kiosk account provisioned
  rows_missing int not null default 0,
  rows_invalid int not null default 0,
  error text
);
create index roster_sync_runs_facility_idx on public.roster_sync_runs (facility_id, started_at desc);

-- Normalized rows from any source format. The importer (adapter per facility) parses its feed into these.
create table public.roster_sync_rows (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.roster_sync_runs (id) on delete cascade,
  facility_id uuid not null references public.facilities (id),
  external_id text,
  booking_number text not null,
  full_name text not null,
  housing_unit text,
  custody_status public.custody_status not null default 'active',
  admission_date date,
  outcome text check (outcome in ('updated', 'unchanged', 'new_admission', 'invalid')),
  resident_id uuid references public.residents (id),
  error text
);
create index roster_sync_rows_run_idx on public.roster_sync_rows (run_id);

alter table public.roster_sync_runs enable row level security;
alter table public.roster_sync_rows enable row level security;
-- Staff can see their facility's import history; only the service role writes.
create policy roster_runs_select_staff on public.roster_sync_runs for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());
revoke all on public.roster_sync_runs, public.roster_sync_rows from anon, authenticated;
grant select on public.roster_sync_runs to authenticated;

-- Applies a staged run. Matches by external_id, then booking number, inside the run's facility only.
--  * existing residents: name, housing, custody status, admission date updated; last_synced_at set
--  * unknown residents: marked 'new_admission' for the importer to provision a kiosk login (the same path as
--    staff intake), then insert and re-run; nothing is created here because every resident needs an account
--  * residents absent from a COMPLETE snapshot: missing_from_roster_since is set. Nothing is deleted and custody
--    is not changed automatically; staff (or a later explicit 'released' row) decide. Incremental feeds never
--    mark anyone missing.
--  * a run that fails validation is marked failed and changes nothing.
create function public.apply_roster_sync(p_run uuid) returns public.roster_sync_runs
language plpgsql security definer set search_path = public as $$
declare
  v_run public.roster_sync_runs;
  r record;
  v_res public.residents;
  v_updated int := 0; v_new int := 0; v_invalid int := 0; v_missing int := 0;
begin
  select * into v_run from public.roster_sync_runs where id = p_run for update;
  if v_run.id is null or v_run.status <> 'running' then
    raise exception 'run not found or already applied' using errcode = 'P0002';
  end if;

  for r in select * from public.roster_sync_rows where run_id = p_run and facility_id = v_run.facility_id loop
    if r.booking_number !~ '^[A-Za-z0-9-]{3,20}$' or char_length(btrim(r.full_name)) < 2 then
      update public.roster_sync_rows set outcome = 'invalid', error = 'invalid booking number or name' where id = r.id;
      v_invalid := v_invalid + 1;
      continue;
    end if;

    v_res := null;
    if r.external_id is not null then
      select * into v_res from public.residents where facility_id = v_run.facility_id and external_id = r.external_id;
    end if;
    if v_res.id is null then
      select * into v_res from public.residents where facility_id = v_run.facility_id and upper(booking_number) = upper(r.booking_number);
      -- A booking-number-only match must be the same person: names may change only via a stable external id.
      if v_res.id is not null and (
           public.normalize_person_name(v_res.full_name) <> public.normalize_person_name(r.full_name)
           or (r.external_id is not null and v_res.external_id is not null and v_res.external_id <> r.external_id)) then
        update public.roster_sync_rows set outcome = 'invalid', resident_id = v_res.id,
          error = 'booking number belongs to a different person' where id = r.id;
        v_invalid := v_invalid + 1;
        continue;
      end if;
    end if;

    if v_res.id is null then
      update public.roster_sync_rows set outcome = 'new_admission' where id = r.id;
      v_new := v_new + 1;
      continue;
    end if;

    begin
      update public.residents set
        external_id = coalesce(r.external_id, external_id),
        booking_number = r.booking_number,
        full_name = btrim(r.full_name),
        housing_unit = r.housing_unit,
        admission_date = coalesce(r.admission_date, admission_date),
        custody_changed_at = case when custody_status <> r.custody_status then now() else custody_changed_at end,
        custody_status = r.custody_status,
        roster_source = 'sync',
        last_synced_at = now(),
        missing_from_roster_since = null
      where id = v_res.id;
      update public.roster_sync_rows set outcome = 'updated', resident_id = v_res.id where id = r.id;
      v_updated := v_updated + 1;
    exception when unique_violation then
      -- e.g. a booking number or external id that already belongs to another resident: leave both untouched.
      update public.roster_sync_rows set outcome = 'invalid', resident_id = v_res.id, error = 'conflicts with another resident' where id = r.id;
      v_invalid := v_invalid + 1;
    end;
  end loop;

  if v_run.is_complete_snapshot then
    update public.residents res set missing_from_roster_since = coalesce(res.missing_from_roster_since, now())
     where res.facility_id = v_run.facility_id and res.custody_status = 'active'
       and not exists (select 1 from public.roster_sync_rows sr where sr.run_id = p_run and sr.resident_id = res.id);
    get diagnostics v_missing = row_count;
  end if;

  update public.roster_sync_runs set
    status = case when v_invalid > 0 or v_new > 0 then 'partial'::public.roster_run_status else 'succeeded'::public.roster_run_status end,
    finished_at = now(), rows_received = v_updated + v_new + v_invalid,
    rows_updated = v_updated, rows_new = v_new, rows_missing = v_missing, rows_invalid = v_invalid
  where id = p_run returning * into v_run;

  perform public.log_action(v_run.facility_id, 'roster.sync', 'roster_sync_run', v_run.id::text,
    jsonb_build_object('updated', v_updated, 'new', v_new, 'missing', v_missing, 'invalid', v_invalid, 'source', v_run.source));
  return v_run;
end $$;
revoke execute on function public.apply_roster_sync(uuid) from public, anon, authenticated;
grant execute on function public.apply_roster_sync(uuid) to service_role;
