begin;
\ir helpers.inc
select * from no_plan();

-- F1: family home facility. F2: another listed facility. F3: unlisted.
insert into public.facilities (id, name, slug, listed) values
  ('11111111-0000-0000-0000-000000000001', 'Alpha County', 'f1', true),
  ('22222222-0000-0000-0000-000000000002', 'Bravo County', 'f2', true),
  ('33333333-0000-0000-0000-000000000003', 'Closed Unit', 'f3', false);
select tests.mk_user('a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'staff', 'f1staff');
select tests.mk_user('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'family', 'famA');
select tests.mk_user('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'family', 'famB');
select tests.mk_user('b2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'staff', 'f2staff');
select tests.mk_user('b2000000-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000002', 'resident', 'res2a');
select tests.mk_user('b2000000-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000002', 'resident', 'res2b');
select tests.mk_user('c3000000-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000003', 'resident', 'res3');
insert into public.residents (id, facility_id, user_id, booking_number, full_name, housing_unit, custody_status) values
  ('d2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000005', 'B-1001', 'Jordan O''Neil', 'Unit 4', 'active'),
  ('d2000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000006', 'B-1002', 'Sam Released', null, 'released'),
  ('d3000000-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', 'C-1001', 'Hidden Person', null, 'active');
insert into storage.objects (bucket_id, name) values
  ('id-photos', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000003/id.jpg'),
  ('id-photos', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000003/id2.jpg'),
  ('id-photos', '11111111-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003/home.jpg');

-- ---------------------------------------------------------------- facility list
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select ok((select array_agg(slug) from public.list_connect_facilities()) @> array['f1', 'f2'], 'family sees listed facilities');
select ok(not exists (select 1 from public.list_connect_facilities() where slug = 'f3'), 'unlisted facility is not offered');

-- ---------------------------------------------------------------- roster privacy
select is((select count(*)::int from public.residents), 0, 'family cannot read the roster table');
select throws_ok($$select * from public.roster_lookups$$, '42501', null, 'family cannot read lookup history');
select throws_ok($$select public.match_roster_resident('22222222-0000-0000-0000-000000000002', 'x', 'B-1001')$$, '42501', null, 'family cannot call the raw matcher');

-- ---------------------------------------------------------------- verification
select is(public.verify_resident('22222222-0000-0000-0000-000000000002', 'jordan oneil', 'b-1001'), true, 'match ignores case and punctuation');
select is(public.verify_resident('22222222-0000-0000-0000-000000000002', 'Jordan O''Neil', 'B-1002'), false, 'right name, wrong booking: no match');
select is(public.verify_resident('22222222-0000-0000-0000-000000000002', 'Sam Released', 'B-1002'), false, 'released resident does not match');
select is(public.verify_resident('11111111-0000-0000-0000-000000000001', 'Jordan O''Neil', 'B-1001'), false, 'resident of another facility does not match');
select throws_ok($$select public.verify_resident('33333333-0000-0000-0000-000000000003', 'Hidden Person', 'C-1001')$$, '22023', 'unknown facility', 'unlisted facility cannot be searched');
select throws_ok($$select public.verify_resident('22222222-0000-0000-0000-000000000002', 'J', 'B-1001')$$, '22023', null, 'full name required');
select throws_ok($$select public.verify_resident('22222222-0000-0000-0000-000000000002', 'Jordan', '%')$$, '22023', null, 'booking number pattern enforced (no wildcards)');
reset role;
select ok(not exists (select 1 from public.roster_lookups where to_jsonb(roster_lookups)::text ~* 'jordan|B-1001'),
  'lookup log stores no names or booking numbers');

select tests.as_user('b2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.verify_resident('22222222-0000-0000-0000-000000000002', 'Jordan O''Neil', 'B-1001')$$, '42501', null, 'staff use the roster screens, not family lookup');
reset role;
select tests.as_user('b2000000-0000-0000-0000-000000000005');
select throws_ok($$select public.verify_resident('22222222-0000-0000-0000-000000000002', 'Jordan O''Neil', 'B-1001')$$, '42501', null, 'residents cannot look up residents');
reset role;

-- rate limit: famB gets 5 misses per hour
select tests.as_user('a1000000-0000-0000-0000-000000000004');
select public.verify_resident('22222222-0000-0000-0000-000000000002', 'Guess ' || n, 'G-000' || n) from generate_series(1, 5) n;
select throws_ok($$select public.verify_resident('22222222-0000-0000-0000-000000000002', 'Jordan O''Neil', 'B-1001')$$, 'P0001', 'too many lookups; please try again later', 'sixth miss within an hour is refused');
reset role;

-- ---------------------------------------------------------------- ID photo storage
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('id-photos', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000003/up.jpg')$$,
  'family may upload an ID photo for a listed facility');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('id-photos', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000004/up.jpg')$$,
  '42501', null, 'family cannot upload into another user''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('id-photos', '33333333-0000-0000-0000-000000000003/a1000000-0000-0000-0000-000000000003/up.jpg')$$,
  '42501', null, 'family cannot upload for an unlisted facility');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from storage.objects where bucket_id = 'id-photos' and name like '%a1000000-0000-0000-0000-000000000003%'), 0, 'other families cannot see ID photos');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from storage.objects where bucket_id = 'id-photos' and name like '22222222-%'), 0, 'staff of another facility cannot see the ID photo');
reset role;
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select ok((select count(*)::int from storage.objects where bucket_id = 'id-photos' and name like '22222222-%/a1000000-0000-0000-0000-000000000003/%') >= 2, 'reviewing facility staff can see the ID photo');
reset role;

-- ---------------------------------------------------------------- cross-facility request
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.request_connection('22222222-0000-0000-0000-000000000002'::uuid, 'Jordan O''Neil', 'B-1001', 'Sister', '11111111-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003/home.jpg')$$,
  '22023', 'invalid ID photo path', 'ID photo must be stored under the reviewing facility');
select throws_ok($$select public.request_connection('22222222-0000-0000-0000-000000000002'::uuid, 'Jordan O''Neil', 'B-1001', 'Sister', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000003/missing.jpg')$$,
  '22023', 'invalid ID photo path', 'ID photo must exist');
select lives_ok($$select public.request_connection('22222222-0000-0000-0000-000000000002'::uuid, 'Jordan O''Neil', 'B-1001', 'Sister', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000003/id.jpg')$$,
  'matched cross-facility request accepted');
select lives_ok($$select public.request_connection('22222222-0000-0000-0000-000000000002'::uuid, 'Jordan ONeil', 'B-9999', 'Sister', '22222222-0000-0000-0000-000000000002/a1000000-0000-0000-0000-000000000003/id2.jpg')$$,
  'wrong booking: request accepted for staff check, unmatched');
select is((select count(*)::int from public.contacts where family_user_id = 'a1000000-0000-0000-0000-000000000003'), 0, 'a roster match does not create a connection');
reset role;

select is((select facility_id from public.connection_requests where typed_booking_number = 'B-1001'), '22222222-0000-0000-0000-000000000002'::uuid, 'request belongs to the resident''s facility');
select is((select resident_id from public.connection_requests where typed_booking_number = 'B-9999'), null, 'wrong booking is not linked to anyone');

select tests.as_user('a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.connection_requests), 0, 'home facility staff do not see the request');
select throws_ok($$select public.decide_connection((select id from public.connection_requests limit 1), true)$$, 'P0002', null, 'home facility staff cannot decide it');
reset role;

select tests.as_user('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.connection_requests where status = 'pending'), 2, 'reviewing facility staff see both requests');
select throws_ok($$select public.decide_connection((select id from public.connection_requests where typed_booking_number = 'B-9999'), true)$$,
  'P0001', 'no matching resident; link a resident or deny', 'unmatched request cannot be approved');
select throws_ok($$select public.link_request_resident((select id from public.connection_requests where typed_booking_number = 'B-9999'), 'd2000000-0000-0000-0000-000000000002')$$,
  'P0002', 'resident not found', 'cannot link a released resident');
select throws_ok($$select public.link_request_resident((select id from public.connection_requests where typed_booking_number = 'B-9999'), 'd3000000-0000-0000-0000-000000000001')$$,
  'P0002', 'resident not found', 'cannot link a resident of another facility');
select throws_ok($$select public.link_request_resident((select id from public.connection_requests where typed_booking_number = 'B-9999'), 'd2000000-0000-0000-0000-000000000001')$$,
  'P0001', null, 'cannot link while the same family has another pending request for that resident');
select lives_ok($$select public.decide_connection((select id from public.connection_requests where typed_booking_number = 'B-1001'), true)$$, 'staff approve');
select lives_ok($$select public.link_request_resident((select id from public.connection_requests where typed_booking_number = 'B-9999'), 'd2000000-0000-0000-0000-000000000001')$$,
  'staff can link a verified resident');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'connection.link_resident'), 'manual link is audited');
select is((select facility_id from public.contacts where family_user_id = 'a1000000-0000-0000-0000-000000000003'), '22222222-0000-0000-0000-000000000002'::uuid, 'contact belongs to the resident''s facility');

select tests.as_user('a1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.link_request_resident((select id from public.connection_requests where typed_booking_number = 'B-9999'), 'd2000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'other facility staff cannot link');
reset role;

-- ---------------------------------------------------------------- messaging + visits follow the contact's facility
update public.facilities set settings = settings || '{"hold_all_messages": true}' where id = '22222222-0000-0000-0000-000000000002';
update public.facilities set settings = settings || '{"hold_all_messages": false}' where id = '11111111-0000-0000-0000-000000000001';
insert into public.visit_slots (id, facility_id, starts_at, ends_at) values
  ('e1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 30 minutes'),
  ('e2000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 30 minutes');

select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.send_message((select contact_id from public.list_my_contacts() limit 1), 'hello from another county')$$, 'family can message a cross-facility contact');
select is((select facility_id from public.messages where body = 'hello from another county'), '22222222-0000-0000-0000-000000000002'::uuid, 'message belongs to the resident''s facility');
select is((select status::text from public.messages where body = 'hello from another county'), 'held', 'resident facility''s review setting applies (not the family''s)');
select set_eq($$select slot_id from public.list_open_slots_for_contact((select contact_id from public.list_my_contacts() limit 1))$$,
  array['e2000000-0000-0000-0000-000000000002'::uuid], 'slots offered are the contact''s facility');
select throws_ok($$select public.request_visit((select contact_id from public.list_my_contacts() limit 1), 'e1000000-0000-0000-0000-000000000001')$$,
  'P0001', 'that time is not available', 'cannot book a slot at the wrong facility');
select lives_ok($$select public.request_visit((select contact_id from public.list_my_contacts() limit 1), 'e2000000-0000-0000-0000-000000000002')$$, 'can book the contact''s facility slot');
select is((select count(*)::int from public.visits v join public.visit_slots s on s.id = v.slot_id), 1, 'family can read the visit''s slot time');
reset role;

select tests.as_user('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.messages where body = 'hello from another county'), 1, 'resident facility staff review the message');
select is((select facility_id from public.visits limit 1), '22222222-0000-0000-0000-000000000002'::uuid, 'visit belongs to the resident''s facility');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.messages), 0, 'home facility staff cannot see it');
reset role;

-- ---------------------------------------------------------------- roster sync
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.apply_roster_sync(gen_random_uuid())$$, '42501', null, 'clients cannot apply roster imports');
reset role;

insert into public.roster_sync_runs (id, facility_id, source, is_complete_snapshot) values
  ('f0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'csv', true);
insert into public.roster_sync_rows (run_id, facility_id, external_id, booking_number, full_name, housing_unit, custody_status) values
  ('f0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'JMS-77', 'B-1001', 'Jordan O''Neil', 'Unit 9', 'active'),
  ('f0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'JMS-88', 'B-2000', 'New Admission', null, 'active'),
  ('f0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', null, '%%', 'Bad Row', null, 'active'),
  -- a row for another facility smuggled into this run is ignored
  ('f0000000-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', null, 'C-1001', 'Hidden Person', null, 'released');
select is((select status::text from public.apply_roster_sync('f0000000-0000-0000-0000-000000000001')), 'partial', 'run with new/invalid rows is partial');
select is((select housing_unit from public.residents where id = 'd2000000-0000-0000-0000-000000000001'), 'Unit 9', 'existing resident updated in place');
select is((select external_id from public.residents where id = 'd2000000-0000-0000-0000-000000000001'), 'JMS-77', 'stable external id recorded');
select is((select count(*)::int from public.residents where facility_id = '22222222-0000-0000-0000-000000000002'), 2, 'no duplicates and nothing created without an account');
select is((select outcome from public.roster_sync_rows where booking_number = 'B-2000'), 'new_admission', 'new admission flagged for provisioning');
select is((select outcome from public.roster_sync_rows where booking_number = '%%'), 'invalid', 'invalid row rejected');
select is((select custody_status::text from public.residents where id = 'd3000000-0000-0000-0000-000000000001'), 'active', 'rows for another facility are ignored');
select is((select count(*)::int from public.contacts where family_user_id = 'a1000000-0000-0000-0000-000000000003'), 1, 'existing connections preserved');

-- second complete snapshot without Jordan: flagged missing, not released or deleted
insert into public.roster_sync_runs (id, facility_id, source, is_complete_snapshot) values
  ('f0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'csv', true);
select public.apply_roster_sync('f0000000-0000-0000-0000-000000000002');
select ok((select missing_from_roster_since is not null and custody_status = 'active' from public.residents where id = 'd2000000-0000-0000-0000-000000000001'),
  'resident missing from a complete roster is flagged, not released');
select is((select count(*)::int from public.messages where facility_id = '22222222-0000-0000-0000-000000000002'), 1, 'message history preserved');

-- incremental feed: explicit release + matched by external id after a booking-number change
insert into public.roster_sync_runs (id, facility_id, source, is_complete_snapshot) values
  ('f0000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', 'api', false);
insert into public.roster_sync_rows (run_id, facility_id, external_id, booking_number, full_name, custody_status) values
  ('f0000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', 'JMS-77', 'B-1001X', 'Jordan O''Neil', 'released'),
  ('f0000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', null, 'B-1001X', 'Sam Released', 'released');
select public.apply_roster_sync('f0000000-0000-0000-0000-000000000003');
select is((select booking_number || '/' || custody_status from public.residents where id = 'd2000000-0000-0000-0000-000000000001'), 'B-1001X/released', 'matched by external id across booking change; release applied');
select is((select outcome from public.roster_sync_rows where run_id = 'f0000000-0000-0000-0000-000000000003' and full_name = 'Sam Released'), 'invalid', 'booking number collision is rejected, not merged');
select is((select missing_from_roster_since from public.residents where id = 'd2000000-0000-0000-0000-000000000001'), null, 'reappearing resident clears the missing flag');

select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is(public.verify_resident('22222222-0000-0000-0000-000000000002', 'Jordan O''Neil', 'B-1001X'), false, 'released resident can no longer be verified');
reset role;
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.roster_sync_runs), 3, 'staff see their facility''s import history');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.roster_sync_runs), 0, 'other facility staff do not');
reset role;

select * from finish();
rollback;
