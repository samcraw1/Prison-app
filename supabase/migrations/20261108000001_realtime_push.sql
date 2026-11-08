-- Mobile support: realtime change feeds and push notifications.
-- Additive only: no existing table, policy or function changes.

-- ------------------------------------------------------------------ Realtime
-- Supabase Realtime evaluates each subscriber's SELECT policies before delivering a change, so these feeds
-- expose exactly what the existing RLS already allows (a family never receives a held resident message).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.messages, public.visits, public.connection_requests, public.contacts;

-- --------------------------------------------------------------- Push tokens
create table public.push_tokens (
  token text primary key check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  user_id uuid not null references public.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
create policy push_tokens_select_own on public.push_tokens for select to authenticated using (user_id = auth.uid());
revoke all on public.push_tokens from anon, authenticated;
grant select on public.push_tokens to authenticated;

-- A device token belongs to whoever signed in on that device last.
create function public.register_push_token(p_token text, p_platform text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and status = 'active' and role = 'family') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.push_tokens (token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create function public.remove_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text), public.remove_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text), public.remove_push_token(text) to authenticated;

-- ---------------------------------------------------------------- Push outbox
-- Notification text is composed here, in the database, from fixed strings only. It never contains message
-- bodies, resident names, booking numbers or deny reasons, because lock screens and push providers are not
-- trusted with them. The app fetches details over RLS after the user opens it.
create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index push_outbox_pending_idx on public.push_outbox (created_at) where sent_at is null;
alter table public.push_outbox enable row level security; -- no policies: service role only
revoke all on public.push_outbox from anon, authenticated;

create function public.enqueue_push(p_user uuid, p_title text, p_body text, p_data jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.push_outbox (user_id, title, body, data)
  select p_user, p_title, p_body, p_data
   where exists (select 1 from public.push_tokens where user_id = p_user);
$$;
revoke execute on function public.enqueue_push(uuid, text, text, jsonb) from public, anon, authenticated;

create function public.push_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid;
begin
  select family_user_id into v_family from public.contacts where id = new.contact_id;
  if new.sender = 'resident' and new.status = 'delivered'
     and (tg_op = 'INSERT' or old.status is distinct from 'delivered') then
    perform public.enqueue_push(v_family, 'New message', 'You have a new message. Open the app to read it.',
      jsonb_build_object('type', 'message', 'contactId', new.contact_id));
  elsif new.sender = 'family' and tg_op = 'UPDATE' and new.status = 'rejected' and old.status <> 'rejected' then
    perform public.enqueue_push(v_family, 'Message not delivered', 'A message you sent was not delivered. Open the app for details.',
      jsonb_build_object('type', 'message', 'contactId', new.contact_id));
  end if;
  return null;
end $$;
create trigger messages_push after insert or update of status on public.messages
  for each row execute function public.push_on_message();

create function public.push_on_connection() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'denied') then
    perform public.enqueue_push(new.family_user_id, 'Connection request update',
      case when new.status = 'approved' then 'Your connection request was approved.'
           else 'Your connection request was not approved. Open the app for details.' end,
      jsonb_build_object('type', 'connection'));
  end if;
  return null;
end $$;
create trigger connection_requests_push after update of status on public.connection_requests
  for each row execute function public.push_on_connection();

create function public.push_on_visit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_family uuid;
begin
  if old.status = 'requested' and new.status in ('approved', 'denied') then
    select family_user_id into v_family from public.contacts where id = new.contact_id;
    perform public.enqueue_push(v_family, 'Video visit update',
      case when new.status = 'approved' then 'Your video visit was approved.'
           else 'Your video visit request was not approved. Open the app for details.' end,
      jsonb_build_object('type', 'visit', 'visitId', new.id));
  end if;
  return null;
end $$;
create trigger visits_push after update of status on public.visits
  for each row execute function public.push_on_visit();

revoke execute on function public.push_on_message(), public.push_on_connection(), public.push_on_visit() from public, anon, authenticated;

-- Used only by the push-dispatch edge function (service role).
create function public.claim_push_batch(p_limit int default 100)
returns table (id bigint, user_id uuid, title text, body text, data jsonb)
language sql security definer set search_path = public as $$
  update public.push_outbox o
     set claimed_at = now(), attempts = o.attempts + 1
   where o.id in (select p.id from public.push_outbox p
                   where p.sent_at is null and p.attempts < 5
                     and (p.claimed_at is null or p.claimed_at < now() - interval '2 minutes')
                   order by p.id limit least(p_limit, 500)
                   for update skip locked)
  returning o.id, o.user_id, o.title, o.body, o.data;
$$;
revoke execute on function public.claim_push_batch(int) from public, anon, authenticated;
grant execute on function public.claim_push_batch(int) to service_role;
