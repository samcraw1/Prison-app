begin;
\ir helpers.inc
select * from no_plan();

insert into public.facilities (id, name, slug, settings) values
  ('11111111-0000-0000-0000-000000000001', 'F1', 'f1', '{"hold_all_messages": true}');
select tests.mk_user('a1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'staff', 'f1staff');
select tests.mk_user('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'family', 'famA');
select tests.mk_user('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'family', 'famB');
select tests.mk_user('a1000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'resident', 'res1');
insert into public.residents (id, facility_id, user_id, booking_number, full_name) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'T-SECRET1', 'Zebulon Quixote');
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'Mother');

-- publication -------------------------------------------------------------------------------
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages'), 'messages are published to realtime');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'visits'), 'visits are published to realtime');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('push_outbox', 'push_tokens', 'audit_log', 'residents', 'users')),
  'sensitive tables are not published');

-- push tokens ------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.register_push_token('ExponentPushToken[famA-device-0001]', 'ios')$$, 'family can register a push token');
select throws_ok($$select public.register_push_token('not-a-token', 'ios')$$, '23514', null, 'malformed token rejected');
select throws_ok($$insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[forged-000001]', 'a1000000-0000-0000-0000-000000000004', 'ios')$$,
  '42501', null, 'cannot insert tokens directly');
select throws_ok($$select * from public.push_outbox$$, '42501', null, 'clients cannot read the push outbox');
select throws_ok($$select * from public.claim_push_batch(10)$$, '42501', null, 'clients cannot claim push batches');
select throws_ok($$select public.enqueue_push('a1000000-0000-0000-0000-000000000004', 't', 'b', '{}')$$, '42501', null, 'clients cannot enqueue pushes');
select is((select count(*)::int from public.push_tokens), 1, 'family sees own token');
reset role;

select tests.as_user('a1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.push_tokens), 0, 'family cannot see other users tokens');
select lives_ok($$select public.remove_push_token('ExponentPushToken[famA-device-0001]')$$, 'removing someone else''s token is a no-op');
reset role;
select is((select count(*)::int from public.push_tokens), 1, 'other user''s token still exists');

select tests.as_user('a1000000-0000-0000-0000-000000000005');
select throws_ok($$select public.register_push_token('ExponentPushToken[res-device-00001]', 'android')$$, '42501', null, 'residents cannot register push tokens');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.register_push_token('ExponentPushToken[staff-device-0001]', 'android')$$, '42501', null, 'staff cannot register push tokens');
reset role;

-- outbox content: never contains message text, resident name or booking number ---------------
delete from public.messages;
delete from public.push_outbox;
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select public.send_message('d1000000-0000-0000-0000-000000000001', 'Secret plans: meet at the old mill');
reset role;
select is((select count(*)::int from public.push_outbox), 0, 'held resident message does not notify family');

select tests.as_user('a1000000-0000-0000-0000-000000000002');
select public.review_message((select id from public.messages limit 1), 'approve');
reset role;
select is((select count(*)::int from public.push_outbox where user_id = 'a1000000-0000-0000-0000-000000000003'), 1, 'approved resident message notifies the family');
select ok(not exists (
  select 1 from public.push_outbox
   where (title || ' ' || body || ' ' || data::text) ~* '(secret plans|old mill|zebulon|quixote|T-SECRET1)'
), 'push payload has no message text, resident name or booking number');
select is((select data->>'type' from public.push_outbox limit 1), 'message', 'payload carries only a type and id');

-- family message rejected -> family notified with fixed text
delete from public.push_outbox;
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select public.send_message('d1000000-0000-0000-0000-000000000001', 'bring the thing');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select public.review_message((select id from public.messages where sender = 'family' limit 1), 'reject', 'policy: contraband reference');
reset role;
select is((select body from public.push_outbox), 'A message you sent was not delivered. Open the app for details.', 'rejection push uses fixed text');
select ok(not exists (select 1 from public.push_outbox where body ~* 'contraband|bring the thing'), 'rejection push omits reason and body');

-- users without tokens get nothing queued
delete from public.push_outbox;
delete from public.push_tokens;
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select public.send_message('d1000000-0000-0000-0000-000000000001', 'hello again');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select public.review_message((select id from public.messages where body = 'hello again'), 'approve');
reset role;
select is((select count(*)::int from public.push_outbox), 0, 'no outbox rows for users without devices');

select * from finish();
rollback;
