-- Step 2: connection requests, approved contacts, ID photo storage.

create type public.request_status as enum ('pending', 'approved', 'denied');
create type public.contact_status as enum ('active', 'blocked');

create table public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  family_user_id uuid not null references public.users (id) on delete cascade,
  resident_id uuid references public.residents (id),          -- null when no match was found
  typed_resident_name text not null check (char_length(typed_resident_name) between 2 and 100),
  typed_booking_number text not null check (typed_booking_number ~ '^[A-Za-z0-9-]{3,20}$'),
  relationship text not null check (char_length(relationship) between 2 and 40),
  id_photo_path text not null,
  status public.request_status not null default 'pending',
  decided_by uuid references public.users (id),
  decided_at timestamptz,
  deny_reason text check (deny_reason is null or char_length(deny_reason) <= 300),
  created_at timestamptz not null default now()
);
create index connection_requests_queue_idx on public.connection_requests (facility_id, status, created_at);
create unique index connection_requests_one_pending on public.connection_requests (family_user_id, resident_id)
  where status = 'pending' and resident_id is not null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  resident_id uuid not null references public.residents (id) on delete cascade,
  family_user_id uuid not null references public.users (id) on delete cascade,
  relationship text not null,
  status public.contact_status not null default 'active',
  request_id uuid references public.connection_requests (id),
  created_at timestamptz not null default now(),
  unique (resident_id, family_user_id)
);
create index contacts_family_idx on public.contacts (family_user_id);

alter table public.connection_requests enable row level security;
alter table public.contacts enable row level security;

create policy requests_select_family on public.connection_requests for select to authenticated
  using (family_user_id = auth.uid());
create policy requests_select_staff on public.connection_requests for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

create policy contacts_select_family on public.contacts for select to authenticated
  using (family_user_id = auth.uid());
create policy contacts_select_resident on public.contacts for select to authenticated
  using (status = 'active' and resident_id in (select id from public.residents where user_id = auth.uid()));
create policy contacts_select_staff on public.contacts for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

revoke all on public.connection_requests, public.contacts from anon, authenticated;
grant select on public.connection_requests, public.contacts to authenticated;

-- ------------------------------------------------------------ functions
-- Family creates a request. Resident lookup happens here so families can never read the residents table.
create function public.request_connection(
  p_resident_name text, p_booking text, p_relationship text, p_id_photo_path text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
  v_resident public.residents;
  v_id uuid;
begin
  select * into v_user from public.users where id = auth.uid() and status = 'active';
  if v_user.id is null or v_user.role <> 'family' then
    raise exception 'only family accounts can request a connection' using errcode = '42501';
  end if;
  if p_id_photo_path is null or p_id_photo_path not like (v_user.facility_id::text || '/' || v_user.id::text || '/%') then
    raise exception 'invalid ID photo path' using errcode = '22023';
  end if;

  select * into v_resident from public.residents
   where facility_id = v_user.facility_id
     and booking_number = btrim(p_booking)
     and lower(btrim(full_name)) = lower(btrim(p_resident_name));

  insert into public.connection_requests
    (facility_id, family_user_id, resident_id, typed_resident_name, typed_booking_number, relationship, id_photo_path)
  values
    (v_user.facility_id, v_user.id, v_resident.id, btrim(p_resident_name), btrim(p_booking), btrim(p_relationship), p_id_photo_path)
  returning id into v_id;

  perform public.log_action(v_user.facility_id, 'connection.request', 'connection_request', v_id::text,
    jsonb_build_object('matched', v_resident.id is not null));
  return v_id;
end $$;

create function public.decide_connection(p_request uuid, p_approve boolean, p_reason text default null)
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
      raise exception 'no matching resident; deny instead' using errcode = 'P0001';
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

create function public.set_contact_status(p_contact uuid, p_status public.contact_status)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_contact public.contacts;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  update public.contacts set status = p_status
   where id = p_contact and facility_id = public.auth_facility()
  returning * into v_contact;
  if v_contact.id is null then
    raise exception 'contact not found' using errcode = 'P0002';
  end if;
  perform public.log_action(v_contact.facility_id,
    case when p_status = 'blocked' then 'contact.block' else 'contact.unblock' end,
    'contact', v_contact.id::text,
    jsonb_build_object('resident_id', v_contact.resident_id, 'family_user_id', v_contact.family_user_id));
end $$;

-- What each side may see about their contacts (names only; no other user data).
create function public.list_my_contacts()
returns table (contact_id uuid, name text, relationship text, resident_id uuid, family_user_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id,
         case when public.auth_role() = 'resident' then u.full_name else r.full_name end,
         c.relationship, c.resident_id, c.family_user_id
    from public.contacts c
    join public.residents r on r.id = c.resident_id
    join public.users u on u.id = c.family_user_id
   where c.status = 'active'
     and ((public.auth_role() = 'family' and c.family_user_id = auth.uid())
       or (public.auth_role() = 'resident' and r.user_id = auth.uid()))
$$;

revoke execute on function public.request_connection(text, text, text, text),
  public.decide_connection(uuid, boolean, text),
  public.set_contact_status(uuid, public.contact_status),
  public.list_my_contacts() from public, anon;
grant execute on function public.request_connection(text, text, text, text),
  public.decide_connection(uuid, boolean, text),
  public.set_contact_status(uuid, public.contact_status),
  public.list_my_contacts() to authenticated;

-- ------------------------------------------------------- ID photo storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('id-photos', 'id-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy id_photos_insert_family on storage.objects for insert to authenticated
  with check (
    bucket_id = 'id-photos'
    and public.auth_role() = 'family'
    and (storage.foldername(name))[1] = public.auth_facility()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );
create policy id_photos_select_owner on storage.objects for select to authenticated
  using (bucket_id = 'id-photos' and (storage.foldername(name))[2] = auth.uid()::text);
create policy id_photos_select_staff on storage.objects for select to authenticated
  using (bucket_id = 'id-photos' and public.is_staff() and (storage.foldername(name))[1] = public.auth_facility()::text);
