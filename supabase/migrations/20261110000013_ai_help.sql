-- v1.1 AI, part 1: per-facility AI switches and the family help bot. See docs/AI.md.
--
-- The help bot answers from the platform FAQ plus the FAQ and policies of the family's facilities. It never
-- reads messages, visits, residents or anything else about a person; the route gets its context only from
-- help_context() below. Nothing typed into the bot is stored: help_usage keeps a per-day count for the limit.

-- ------------------------------------------------------------------ settings
-- Same rules as 20261108000003_payments.sql (copied unchanged), plus three optional booleans (missing = off).
-- Known, pre-existing: a *missing* required key evaluates to NULL, which a CHECK lets through. Left as is so this
-- migration can't fail on existing rows; see docs/AI.md "Open items".
alter table public.facilities drop constraint facility_settings_valid;
alter table public.facilities
  add constraint facility_settings_valid check (
    jsonb_typeof(settings->'hold_all_messages') = 'boolean'
    and (settings->>'max_visit_minutes') ~ '^[0-9]+$'
    and (settings->>'max_visit_minutes')::int between 5 and 120
    and (settings->>'max_visits_per_week') ~ '^[0-9]+$'
    and (settings->>'max_visits_per_week')::int between 1 and 14
    -- Optional rate card (whole cents). Caps are sanity limits, not legal rate caps: see docs/PAYMENTS.md.
    and (not settings ? 'message_fee_cents'
         or ((settings->>'message_fee_cents') ~ '^[0-9]{1,4}$' and (settings->>'message_fee_cents')::int <= 500))
    and (not settings ? 'visit_fee_cents'
         or ((settings->>'visit_fee_cents') ~ '^[0-9]{1,5}$' and (settings->>'visit_fee_cents')::int <= 5000))
    and (not settings ? 'free_messages_per_week'
         or ((settings->>'free_messages_per_week') ~ '^[0-9]{1,3}$' and (settings->>'free_messages_per_week')::int <= 500))
    -- Optional AI switches (v1.1). Off unless present and true.
    and (not settings ? 'help_bot_enabled' or jsonb_typeof(settings->'help_bot_enabled') = 'boolean')
    and (not settings ? 'translation_enabled' or jsonb_typeof(settings->'translation_enabled') = 'boolean')
    and (not settings ? 'ai_review_enabled' or jsonb_typeof(settings->'ai_review_enabled') = 'boolean')
  );

-- ------------------------------------------------------------------ facility FAQ
create table public.facility_help (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 3 and 200),
  answer text not null check (char_length(btrim(answer)) between 1 and 2000),
  updated_by uuid references public.users (id),
  updated_at timestamptz not null default now()
);
create index facility_help_facility_idx on public.facility_help (facility_id);
alter table public.facility_help enable row level security;

-- Staff read their own facility's entries directly. Families never read the table; they get entries only through
-- help_context(), and only for facilities they are connected to.
create policy facility_help_select_staff on public.facility_help for select to authenticated
  using (public.is_staff() and facility_id = public.auth_facility());

revoke all on public.facility_help from anon, authenticated;
grant select on public.facility_help to authenticated;

create function public.save_facility_help(p_id uuid, p_question text, p_answer text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_facility uuid := public.auth_facility();
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.facility_help (facility_id, question, answer, updated_by)
    values (v_facility, btrim(p_question), btrim(p_answer), auth.uid())
    returning id into v_id;
  else
    update public.facility_help
       set question = btrim(p_question), answer = btrim(p_answer), updated_by = auth.uid(), updated_at = now()
     where id = p_id and facility_id = v_facility
    returning id into v_id;
    if v_id is null then
      raise exception 'not found' using errcode = 'P0002';
    end if;
  end if;
  perform public.log_action(v_facility, case when p_id is null then 'help.add' else 'help.update' end,
    'facility_help', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

create function public.delete_facility_help(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_facility uuid := public.auth_facility();
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.facility_help where id = p_id and facility_id = v_facility;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.log_action(v_facility, 'help.delete', 'facility_help', p_id::text, '{}'::jsonb);
end $$;

revoke execute on function public.save_facility_help(uuid, text, text), public.delete_facility_help(uuid)
  from public, anon;
grant execute on function public.save_facility_help(uuid, text, text), public.delete_facility_help(uuid)
  to authenticated;

-- ------------------------------------------------------------------ what the bot may know
-- The facilities a family member is connected to: home facility, active contacts, pending requests.
create function public.my_help_facilities() returns setof uuid
language sql stable security definer set search_path = public as $$
  select f.id
    from public.facilities f
   where public.auth_role() = 'family'
     and coalesce((f.settings->>'help_bot_enabled')::boolean, false)
     and (f.id = public.auth_facility()
          or f.id in (select facility_id from public.contacts where family_user_id = auth.uid() and status = 'active')
          or f.id in (select facility_id from public.connection_requests where family_user_id = auth.uid() and status = 'pending'))
$$;

create function public.help_available() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.my_help_facilities())
$$;

-- Facility names, published policies and FAQ entries. No person-level data.
create function public.help_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'facility', f.name,
           'policies', jsonb_build_object(
             'all_messages_reviewed_before_delivery', coalesce((f.settings->>'hold_all_messages')::boolean, true),
             'max_visit_minutes', (f.settings->>'max_visit_minutes')::int,
             'max_visits_per_week', (f.settings->>'max_visits_per_week')::int,
             'message_fee_cents', coalesce((f.settings->>'message_fee_cents')::int, 0),
             'visit_fee_cents', coalesce((f.settings->>'visit_fee_cents')::int, 0),
             'free_messages_per_week', coalesce((f.settings->>'free_messages_per_week')::int, 0)),
           'faq', coalesce((select jsonb_agg(jsonb_build_object('q', h.question, 'a', h.answer) order by h.updated_at)
                              from public.facility_help h where h.facility_id = f.id), '[]'::jsonb))
           order by f.name), '[]'::jsonb)
    from public.facilities f
   where f.id in (select public.my_help_facilities())
$$;

revoke execute on function public.my_help_facilities(), public.help_available(), public.help_context() from public, anon;
grant execute on function public.my_help_facilities(), public.help_available(), public.help_context() to authenticated;

-- ------------------------------------------------------------------ daily limit
create table public.help_usage (
  user_id uuid not null references public.users (id) on delete cascade,
  day date not null default current_date,
  count int not null default 0 check (count >= 0),
  primary key (user_id, day)
);
alter table public.help_usage enable row level security;
revoke all on public.help_usage from anon, authenticated;  -- no client access at all; only the function below

-- Counts one question for the caller. Returns false (and counts nothing) once the daily limit is reached.
create function public.take_help_question() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if public.auth_role() is distinct from 'family' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.help_usage as u (user_id, day, count) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = u.count + 1 where u.count < 30
  returning count into v_count;
  return v_count is not null;
end $$;
revoke execute on function public.take_help_question() from public, anon;
grant execute on function public.take_help_question() to authenticated;

-- "Report this answer": ids only, never the question or answer text.
create function public.report_help_answer() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.auth_role() is distinct from 'family' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform public.log_action(public.auth_facility(), 'help.report', 'help_answer', null, '{}'::jsonb);
end $$;
revoke execute on function public.report_help_answer() from public, anon;
grant execute on function public.report_help_answer() to authenticated;

-- Erased accounts: drop their counters right away (users rows are kept, so the FK cascade never fires).
create function public.help_usage_on_erase() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.help_usage where user_id = new.id;
  return new;
end $$;
revoke execute on function public.help_usage_on_erase() from public, anon, authenticated;
create trigger users_help_usage_erase after update of status on public.users
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.help_usage_on_erase();

-- ------------------------------------------------------------------ retention (daily cron)
create function public.purge_ai_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usage int;
begin
  delete from public.help_usage where day < current_date - 30;
  get diagnostics v_usage = row_count;
  return jsonb_build_object('help_usage', v_usage);
end $$;
revoke execute on function public.purge_ai_data() from public, anon, authenticated;
grant execute on function public.purge_ai_data() to service_role;
