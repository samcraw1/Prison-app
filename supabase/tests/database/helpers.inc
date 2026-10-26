-- Shared test helpers (installed per test run inside the test transaction via \ir).
create schema if not exists tests;

create or replace function tests.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;

create or replace function tests.mk_user(p_id uuid, p_facility uuid, p_role public.user_role, p_name text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, aud, role) values (p_id, p_name || '@t.test', 'authenticated', 'authenticated');
  insert into public.users (id, facility_id, role, email, full_name) values (p_id, p_facility, p_role, p_name || '@t.test', p_name);
end $$;
