-- Report and block (App Store guideline 1.2). A family member can report a message from a resident and block a
-- contact. Blocking is the family member's own switch: it hides the conversation and stops new messages and
-- visit requests in both directions, without touching the facility's own contact status (staff keep full records).
-- Reports go to the resident's facility staff queue.

alter table public.contacts add column family_blocked_at timestamptz;

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id),
  reporter_id uuid not null references public.users (id),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  reason text not null check (reason in ('harassment', 'threats', 'inappropriate', 'spam', 'other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references public.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index content_reports_queue_idx on public.content_reports (facility_id, status, created_at desc);
alter table public.content_reports enable row level security;
create policy reports_select_staff on public.content_reports for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

-- Hide blocked conversations from the family member.
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
     and ((public.auth_role() = 'family' and c.family_user_id = auth.uid() and c.family_blocked_at is null)
       or (public.auth_role() = 'resident' and c.resident_id = public.my_resident_id() and c.family_blocked_at is null))
$$;

drop policy messages_select_family on public.messages;
create policy messages_select_family on public.messages for select to authenticated
  using (
    (sender = 'family' or status = 'delivered')
    and exists (select 1 from public.contacts c
                 where c.id = messages.contact_id and c.family_user_id = auth.uid() and c.status = 'active'
                   and c.family_blocked_at is null)
  );

-- No new messages or visit requests on a blocked contact, whichever side sends.
create function public.reject_if_family_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.contacts c where c.id = new.contact_id and c.family_blocked_at is not null) then
    raise exception 'unknown contact' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.reject_if_family_blocked() from public, anon, authenticated;
create trigger messages_reject_blocked before insert on public.messages
  for each row execute function public.reject_if_family_blocked();
create trigger visits_reject_blocked before insert on public.visits
  for each row execute function public.reject_if_family_blocked();

create function public.block_contact(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_contact public.contacts;
begin
  if public.auth_role() <> 'family' then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.contacts set family_blocked_at = coalesce(family_blocked_at, now())
   where id = p_contact and family_user_id = auth.uid()
  returning * into v_contact;
  if v_contact.id is null then raise exception 'unknown contact' using errcode = '42501'; end if;
  perform public.log_action(v_contact.facility_id, 'contact.family_block', 'contact', v_contact.id::text,
    jsonb_build_object('resident_id', v_contact.resident_id));
end $$;

create function public.unblock_contact(p_contact uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_contact public.contacts;
begin
  if public.auth_role() <> 'family' then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.contacts set family_blocked_at = null
   where id = p_contact and family_user_id = auth.uid()
  returning * into v_contact;
  if v_contact.id is null then raise exception 'unknown contact' using errcode = '42501'; end if;
  perform public.log_action(v_contact.facility_id, 'contact.family_unblock', 'contact', v_contact.id::text,
    jsonb_build_object('resident_id', v_contact.resident_id));
end $$;

create function public.list_blocked_contacts() returns table (contact_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select c.id, r.full_name
    from public.contacts c join public.residents r on r.id = c.resident_id
   where public.auth_role() = 'family' and c.family_user_id = auth.uid() and c.status = 'active' and c.family_blocked_at is not null
$$;

-- p_message is optional: a report can be about the contact in general. Only delivered resident messages in the
-- reporter's own conversation can be reported.
create function public.report_content(p_contact uuid, p_message uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_contact public.contacts;
  v_id uuid;
begin
  if public.auth_role() <> 'family' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_contact from public.contacts where id = p_contact and family_user_id = auth.uid();
  if v_contact.id is null then raise exception 'unknown contact' using errcode = '42501'; end if;
  if p_message is not null and not exists (
       select 1 from public.messages m
        where m.id = p_message and m.contact_id = p_contact and m.sender = 'resident' and m.status = 'delivered') then
    raise exception 'unknown message' using errcode = '42501';
  end if;
  if (select count(*) from public.content_reports where reporter_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many reports; try again later' using errcode = 'P0001';
  end if;
  insert into public.content_reports (facility_id, reporter_id, contact_id, message_id, reason, details)
  values (v_contact.facility_id, auth.uid(), p_contact, p_message, p_reason, nullif(btrim(p_details), ''))
  returning id into v_id;
  perform public.log_action(v_contact.facility_id, 'report.create', 'content_report', v_id::text,
    jsonb_build_object('reason', p_reason, 'message_id', p_message));
  return v_id;
end $$;

create function public.resolve_report(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_report public.content_reports;
begin
  if not public.is_staff() then raise exception 'staff only' using errcode = '42501'; end if;
  update public.content_reports set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
   where id = p_report and facility_id = public.auth_facility() and status = 'open'
  returning * into v_report;
  if v_report.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  perform public.log_action(v_report.facility_id, 'report.resolve', 'content_report', v_report.id::text);
end $$;

revoke execute on function public.block_contact(uuid), public.unblock_contact(uuid), public.list_blocked_contacts(),
  public.report_content(uuid, uuid, text, text), public.resolve_report(uuid) from public, anon;
grant execute on function public.block_contact(uuid), public.unblock_contact(uuid), public.list_blocked_contacts(),
  public.report_content(uuid, uuid, text, text), public.resolve_report(uuid) to authenticated;
