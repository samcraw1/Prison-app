-- Fires the push-dispatch edge function when notifications are queued (replaces a dashboard "Database Webhook").
-- The function URL and shared secret are read from Supabase Vault ('push_dispatch_url', 'push_dispatch_secret'),
-- so nothing environment-specific or secret lives in this file. Without both vault entries (local dev, CI) it does
-- nothing. Any failure is swallowed: queueing a notification must never roll back the message, visit or request
-- that caused it. The edge function drains up to 100 outbox rows per call, so one call per INSERT statement is enough.
create extension if not exists pg_net with schema extensions;

create function public.notify_push_dispatch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  return null;
end $$;
revoke execute on function public.notify_push_dispatch() from public, anon, authenticated;

create trigger push_outbox_dispatch after insert on public.push_outbox
  for each statement execute function public.notify_push_dispatch();
