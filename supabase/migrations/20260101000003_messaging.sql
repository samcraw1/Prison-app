-- Step 3: messaging, keyword flagging, staff review queue.

create type public.message_status as enum ('held', 'delivered', 'rejected');
create type public.sender_type as enum ('family', 'resident');
create type public.review_action as enum ('approve', 'reject', 'flag');

create table public.flag_keywords (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  word text not null check (word = lower(word) and word ~ '^[a-z0-9][a-z0-9 ''-]{1,39}$'),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (facility_id, word)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  sender public.sender_type not null,
  body text not null check (char_length(body) between 1 and 2000),
  attachment_path text,
  status public.message_status not null default 'held',
  flagged boolean not null default false,
  flag_reasons text[] not null default '{}',
  -- Extension point for per-message pricing. Always 0 in the MVP (see src/lib/pricing.ts).
  fee_cents int not null default 0 check (fee_cents >= 0),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index messages_contact_idx on public.messages (contact_id, created_at);
create index messages_queue_idx on public.messages (facility_id, status, created_at);

create table public.message_reviews (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  message_id uuid not null references public.messages (id) on delete cascade,
  staff_id uuid not null references public.users (id),
  action public.review_action not null,
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);
create index message_reviews_message_idx on public.message_reviews (message_id);

-- The resident row for the signed-in resident, only while their privileges are active.
create function public.my_resident_id() returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from public.residents r
    join public.users u on u.id = r.user_id
   where r.user_id = auth.uid() and not r.comms_suspended and u.status = 'active'
$$;
revoke execute on function public.my_resident_id() from public, anon;
grant execute on function public.my_resident_id() to authenticated;

-- ------------------------------------------------------------------- RLS
alter table public.flag_keywords enable row level security;
alter table public.messages enable row level security;
alter table public.message_reviews enable row level security;

create policy keywords_select_staff on public.flag_keywords for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

create policy messages_select_family on public.messages for select to authenticated
  using (
    (sender = 'family' or status = 'delivered')
    and exists (select 1 from public.contacts c
                 where c.id = messages.contact_id and c.family_user_id = auth.uid() and c.status = 'active')
  );
create policy messages_select_resident on public.messages for select to authenticated
  using (
    (sender = 'resident' or status = 'delivered')
    and exists (select 1 from public.contacts c
                 where c.id = messages.contact_id and c.resident_id = public.my_resident_id() and c.status = 'active')
  );
create policy messages_select_staff on public.messages for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

create policy reviews_select_staff on public.message_reviews for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

revoke all on public.flag_keywords, public.messages, public.message_reviews from anon, authenticated;
grant select on public.flag_keywords, public.messages, public.message_reviews to authenticated;

-- Resident-side contact list must respect suspension.
create or replace function public.list_my_contacts()
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
       or (public.auth_role() = 'resident' and c.resident_id = public.my_resident_id()))
$$;

-- --------------------------------------------------------- send + review
create function public.send_message(p_contact uuid, p_body text, p_attachment_path text default null)
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
    if v_contact.family_user_id <> v_user.id then
      raise exception 'unknown contact' using errcode = '42501';
    end if;
    v_sender := 'family';
  else
    if v_resident.user_id <> v_user.id then
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

  select coalesce((settings->>'hold_all_messages')::boolean, true) into v_hold
    from public.facilities where id = v_user.facility_id;

  select coalesce(array_agg(k.word order by k.word), '{}') into v_matches
    from public.flag_keywords k
   where k.facility_id = v_user.facility_id
     and v_body ~* ('\y' || regexp_replace(k.word, '([.\\+*?\[^\]$(){}=!<>|:-])', '\\\1', 'g') || '\y');

  -- Flagged messages are always held, whatever the facility setting.
  v_status := case when array_length(v_matches, 1) > 0 or v_hold then 'held' else 'delivered' end;

  insert into public.messages (facility_id, contact_id, sender, body, attachment_path, status, flagged, flag_reasons, delivered_at)
  values (v_user.facility_id, v_contact.id, v_sender, v_body, p_attachment_path, v_status,
          coalesce(array_length(v_matches, 1), 0) > 0, v_matches,
          case when v_status = 'delivered' then now() end)
  returning id into v_id;
  return v_id;
end $$;

create function public.review_message(p_message uuid, p_action public.review_action, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_msg public.messages;
  v_reason text := nullif(btrim(left(p_reason, 300)), '');
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  select * into v_msg from public.messages
   where id = p_message and facility_id = public.auth_facility() for update;
  if v_msg.id is null then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  if p_action = 'approve' then
    if v_msg.status <> 'held' then
      raise exception 'only held messages can be approved' using errcode = 'P0001';
    end if;
    update public.messages set status = 'delivered', delivered_at = now() where id = v_msg.id;
  elsif p_action = 'reject' then
    if v_msg.status = 'rejected' then
      raise exception 'message already rejected' using errcode = 'P0001';
    end if;
    if v_reason is null then
      raise exception 'a reason is required to reject' using errcode = '22023';
    end if;
    update public.messages set status = 'rejected' where id = v_msg.id;
  else
    update public.messages set flagged = true,
      flag_reasons = case when v_reason is null then flag_reasons else array_append(flag_reasons, 'staff: ' || v_reason) end
     where id = v_msg.id;
  end if;

  insert into public.message_reviews (facility_id, message_id, staff_id, action, reason)
  values (v_msg.facility_id, v_msg.id, auth.uid(), p_action, v_reason);

  perform public.log_action(v_msg.facility_id, 'message.' || p_action::text, 'message', v_msg.id::text,
    jsonb_build_object('contact_id', v_msg.contact_id, 'reason', v_reason));
end $$;

create function public.add_keyword(p_word text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_word text := lower(btrim(p_word));
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  insert into public.flag_keywords (facility_id, word, created_by)
  values (public.auth_facility(), v_word, auth.uid())
  on conflict (facility_id, word) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.log_action(public.auth_facility(), 'keyword.add', 'flag_keyword', v_id::text, jsonb_build_object('word', v_word));
  end if;
  return v_id;
end $$;

create function public.remove_keyword(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_word text;
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  delete from public.flag_keywords where id = p_id and facility_id = public.auth_facility() returning word into v_word;
  if v_word is not null then
    perform public.log_action(public.auth_facility(), 'keyword.remove', 'flag_keyword', p_id::text, jsonb_build_object('word', v_word));
  end if;
end $$;

revoke execute on function public.send_message(uuid, text, text), public.review_message(uuid, public.review_action, text),
  public.add_keyword(text), public.remove_keyword(uuid) from public, anon;
grant execute on function public.send_message(uuid, text, text), public.review_message(uuid, public.review_action, text),
  public.add_keyword(text), public.remove_keyword(uuid) to authenticated;

-- ------------------------------------------------- attachment storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy attachments_insert_family on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and public.auth_role() = 'family'
    and (storage.foldername(name))[1] = public.auth_facility()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );
-- Visible to anyone who can see the message that references the file (messages RLS applies in the subquery).
create policy attachments_select_via_message on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments' and exists (select 1 from public.messages m where m.attachment_path = storage.objects.name));
create policy attachments_select_owner on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments' and (storage.foldername(name))[2] = auth.uid()::text);
