begin;
\ir helpers.inc
select * from no_plan();

insert into public.facilities (id, name, slug) values
  ('11111111-0000-0000-0000-000000000001', 'F1', 'f1'),
  ('22222222-0000-0000-0000-000000000002', 'F2', 'f2');
select tests.mk_user('a1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'staff', 'f1staff');
select tests.mk_user('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'family', 'famA');
select tests.mk_user('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'family', 'famB');
select tests.mk_user('a1000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'resident', 'res1');
select tests.mk_user('a1000000-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'resident', 'res2');
select tests.mk_user('b2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'staff', 'f2staff');
insert into public.residents (id, facility_id, user_id, booking_number, full_name) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'T-0001', 'Res One'),
  ('c1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006', 'T-0002', 'Res Two');
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'Mother'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004', 'Father');
-- three slots in one calendar week (Mon-Wed, far future), capacity 1; plus a past slot
insert into public.visit_slots (id, facility_id, starts_at, ends_at, capacity) values
  ('51000000-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', '2035-03-05 10:00+00', '2035-03-05 10:30+00', 1),
  ('51000000-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000001', '2035-03-06 10:00+00', '2035-03-06 10:30+00', 1),
  ('51000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000001', '2035-03-07 10:00+00', '2035-03-07 10:30+00', 1),
  ('51000000-0000-0000-0000-00000000000d', '11111111-0000-0000-0000-000000000001', '2035-03-12 10:00+00', '2035-03-12 10:30+00', 2),
  ('51000000-0000-0000-0000-00000000000e', '11111111-0000-0000-0000-000000000001', now() - interval '3 hours', now() - interval '2 hours 30 minutes', 1);
delete from public.visits;

-- requesting ---------------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a')$$, 'family requests a visit');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000a')$$, 'P0001', 'you already requested this time', 'no duplicate request');
select lives_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000b')$$, 'second visit in the week is allowed');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000c')$$, 'P0001', 'weekly visit limit reached', 'weekly limit enforced');
select lives_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000d')$$, 'a different week is fine');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000e')$$, 'P0001', 'that time is not available', 'past slot rejected');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000c')$$, '42501', null, 'cannot use someone else''s contact');
select throws_ok($$update public.visits set status = 'approved'$$, '42501', null, 'cannot update visits directly');
select throws_ok($$select public.decide_visit((select id from public.visits limit 1), true)$$, '42501', null, 'family cannot approve');
select is((select count(*)::int from public.list_open_slots() where slot_id = '51000000-0000-0000-0000-00000000000a'), 0, 'full slot is not offered');
reset role;

select tests.as_user('a1000000-0000-0000-0000-000000000004');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000a')$$, 'P0001', 'that time is full', 'capacity enforced across families');
select is((select count(*)::int from public.visits), 0, 'other family cannot see these visits');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000c')$$, '42501', null, 'resident cannot request');
select is((select count(*)::int from public.visits), 3, 'resident sees their visits');
reset role;
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.visits), 0, 'other facility staff sees nothing');
select throws_ok($$select public.decide_visit((select id from public.visits where false), true)$$, 'P0002', null, 'unknown visit');
reset role;

-- staff decisions -----------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select lives_ok($$select public.decide_visit((select id from public.visits where slot_id = '51000000-0000-0000-0000-00000000000a'), true)$$, 'staff approves');
select throws_ok($$select public.decide_visit((select id from public.visits where slot_id = '51000000-0000-0000-0000-00000000000a'), true)$$, 'P0001', 'visit already decided', 'cannot decide twice');
select lives_ok($$select public.decide_visit((select id from public.visits where slot_id = '51000000-0000-0000-0000-00000000000b'), false, 'No staff available')$$, 'staff denies');
select throws_ok($$select public.end_visit((select id from public.visits where slot_id = '51000000-0000-0000-0000-00000000000a'))$$, 'P0001', 'visit is not live', 'cannot end a visit that is not live');
reset role;
select is((select count(*)::int from public.audit_log where action in ('visit.approve', 'visit.deny') and actor_id = 'a1000000-0000-0000-0000-000000000002'), 2, 'decisions audited with staff id');
select is((select count(*)::int from public.visits where status in ('requested', 'approved') and slot_id = '51000000-0000-0000-0000-00000000000b'), 0, 'denied visit frees the slot');

-- ending ------------------------------------------------------------------------------------------------
update public.visits set status = 'live', started_at = now(), daily_room = 'visit-x' where slot_id = '51000000-0000-0000-0000-00000000000a';
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.end_visit((select id from public.visits where status = 'live'))$$, '42501', null, 'family cannot end a visit');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select lives_ok($$select public.end_visit((select id from public.visits where status = 'live'))$$, 'staff ends a live visit');
reset role;
select is((select ended_by from public.visits where slot_id = '51000000-0000-0000-0000-00000000000a'), 'a1000000-0000-0000-0000-000000000002'::uuid, 'ended_by recorded');
select is((select end_reason from public.visits where slot_id = '51000000-0000-0000-0000-00000000000a'), 'staff', 'end reason recorded');
select is((select count(*)::int from public.audit_log where action = 'visit.end'), 1, 'end is audited');

-- cancel ------------------------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000004');
select throws_ok($$select public.cancel_visit((select id from public.visits where slot_id = '51000000-0000-0000-0000-00000000000d'))$$, 'P0002', null, 'other family cannot cancel');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.cancel_visit((select id from public.visits where slot_id = '51000000-0000-0000-0000-00000000000d'))$$, 'family cancels own visit');
reset role;

-- slots ---------------------------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.create_slot(now() + interval '2 days', 20, 1)$$, '42501', null, 'family cannot create slots');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.create_slot(now() + interval '2 days', 45, 1)$$, '22023', null, 'slot longer than facility max rejected');
select throws_ok($$select public.create_slot(now() - interval '1 hour', 20, 1)$$, '22023', null, 'past slot rejected');
select lives_ok($$select public.create_slot(now() + interval '2 days', 20, 2)$$, 'staff creates a slot');
select throws_ok($$select public.delete_slot('51000000-0000-0000-0000-00000000000a')$$, 'P0001', null, 'slot with history cannot be deleted');
select lives_ok($$select public.delete_slot((select id from public.visit_slots where capacity = 2 and ends_at - starts_at = interval '20 minutes'))$$, 'unused slot can be deleted');
reset role;
select is((select count(*)::int from public.audit_log where action in ('slot.create', 'slot.delete')), 2, 'slot changes audited');

-- expiry ----------------------------------------------------------------------------------------------------
insert into public.visits (id, facility_id, contact_id, slot_id, status, requested_by, started_at) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000e', 'live', 'a1000000-0000-0000-0000-000000000003', now() - interval '3 hours'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000e', 'approved', 'a1000000-0000-0000-0000-000000000004', null);
select public.expire_visits();
select is((select status::text || ':' || end_reason from public.visits where id = 'e0000000-0000-0000-0000-000000000001'), 'ended:time', 'live visit past its slot is closed out');
select is((select status::text || ':' || end_reason from public.visits where id = 'e0000000-0000-0000-0000-000000000002'), 'cancelled:no_show', 'approved visit nobody joined becomes a no-show');

-- suspension / blocking --------------------------------------------------------------------------------------
update public.residents set comms_suspended = true where id = 'c1000000-0000-0000-0000-000000000002';
select tests.as_user('a1000000-0000-0000-0000-000000000004');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-00000000000d')$$, 'P0001', 'visits are currently unavailable', 'suspended resident cannot receive visit requests');
reset role;
update public.contacts set status = 'blocked' where id = 'd1000000-0000-0000-0000-000000000001';
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.visits), 0, 'blocked contact''s visits are hidden');
select throws_ok($$select public.request_visit('d1000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-00000000000d')$$, '42501', null, 'blocked contact cannot request');
reset role;

select * from finish();
rollback;
