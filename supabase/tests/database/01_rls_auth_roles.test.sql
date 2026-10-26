begin;
\ir helpers.inc
select plan(19);

-- fixtures: two facilities, each with admin/staff/family/resident
insert into public.facilities (id, name, slug) values
  ('11111111-0000-0000-0000-000000000001', 'F1', 'f1'),
  ('22222222-0000-0000-0000-000000000002', 'F2', 'f2');
select tests.mk_user('a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'admin', 'f1admin');
select tests.mk_user('a1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'staff', 'f1staff');
select tests.mk_user('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'family', 'f1famA');
select tests.mk_user('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'family', 'f1famB');
select tests.mk_user('a1000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'resident', 'f1res');
select tests.mk_user('b2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'staff', 'f2staff');
select tests.mk_user('b2000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'resident', 'f2res');
insert into public.residents (id, facility_id, user_id, booking_number, full_name) values
  ('c1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'T-0001', 'f1res'),
  ('c2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'T-0002', 'f2res');
select public.log_action('22222222-0000-0000-0000-000000000002', 'test.f2', 'x', '1');
select public.log_action('11111111-0000-0000-0000-000000000001', 'test.f1', 'x', '1');

-- family A
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.users), 1, 'family sees only their own user row');
select is((select count(*)::int from public.users where id = 'a1000000-0000-0000-0000-000000000004'), 0, 'family cannot read another family');
select is((select count(*)::int from public.residents), 0, 'family cannot read residents');
select is((select count(*)::int from public.audit_log), 0, 'family cannot read audit log');
select is((select count(*)::int from public.facilities), 1, 'family sees only their facility');
select throws_ok($$insert into public.audit_log (facility_id, action, entity) values ('11111111-0000-0000-0000-000000000001','forged','x')$$, '42501', null, 'client cannot insert audit rows');
select throws_ok($$select public.log_action('11111111-0000-0000-0000-000000000001','forged','x','1')$$, '42501', null, 'client cannot call log_action');
select throws_ok($$update public.users set role = 'admin' where id = auth.uid()$$, '42501', null, 'user cannot change own role');
reset role;

-- resident
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.residents), 1, 'resident sees only own resident row');
select is((select count(*)::int from public.users), 1, 'resident sees only own user row');
reset role;

-- staff F1
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.users), 5, 'staff sees all users in own facility only');
select is((select count(*)::int from public.residents where facility_id = '22222222-0000-0000-0000-000000000002'), 0, 'staff cannot see other facility residents');
select is((select count(*)::int from public.audit_log), 1, 'staff sees only own facility audit log');
update public.residents set comms_suspended = true where id = 'c1000000-0000-0000-0000-000000000001';
update public.residents set comms_suspended = true where id = 'c2000000-0000-0000-0000-000000000001';
reset role;
select is((select comms_suspended from public.residents where id = 'c2000000-0000-0000-0000-000000000001'), false, 'staff cannot update other facility residents');
select is((select count(*)::int from public.audit_log where action = 'resident.suspend' and actor_id = 'a1000000-0000-0000-0000-000000000002'), 1, 'suspend is audited with staff id');

-- settings: only admin
select tests.as_user('a1000000-0000-0000-0000-000000000002');
update public.facilities set settings = settings || '{"hold_all_messages": false}' where id = '11111111-0000-0000-0000-000000000001';
reset role;
select is((select (settings->>'hold_all_messages')::boolean from public.facilities where id = '11111111-0000-0000-0000-000000000001'), true, 'non-admin staff cannot change settings');
select tests.as_user('a1000000-0000-0000-0000-000000000001');
update public.facilities set settings = settings || '{"hold_all_messages": false}' where id = '11111111-0000-0000-0000-000000000001';
reset role;
select is((select (settings->>'hold_all_messages')::boolean from public.facilities where id = '11111111-0000-0000-0000-000000000001'), false, 'admin can change settings');

-- immutability (even for the table owner)
select throws_ok($$update public.audit_log set action = 'tampered'$$, 'P0001', 'audit_log is append-only', 'audit rows cannot be updated');
select throws_ok($$delete from public.audit_log$$, 'P0001', 'audit_log is append-only', 'audit rows cannot be deleted');

select * from finish();
rollback;
