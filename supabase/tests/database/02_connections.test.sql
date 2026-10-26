begin;
\ir helpers.inc
select plan(23);

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

-- family A requests a connection
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.request_connection('res one', 'T-0001', 'Mother', '11111111-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003/id.jpg')$$, 'family can request a connection (name match is case-insensitive)');
select lives_ok($$select public.request_connection('Nobody Here', 'T-9999', 'Friend', '11111111-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003/id2.jpg')$$, 'unmatched request is accepted without revealing that');
select throws_ok($$select public.request_connection('Res One', 'T-0001', 'Mother', '11111111-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000004/id.jpg')$$, '22023', null, 'cannot point at another user''s ID photo path');
select throws_ok($$update public.connection_requests set status = 'approved'$$, '42501', null, 'family cannot update requests directly');
select throws_ok($$select public.decide_connection(id, true) from public.connection_requests limit 1$$, '42501', null, 'family cannot decide requests');
select is((select count(*)::int from public.connection_requests), 2, 'family sees own requests');
reset role;

select tests.as_user('a1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.connection_requests), 0, 'other family cannot see those requests');
reset role;

select tests.as_user('a1000000-0000-0000-0000-000000000005');
select throws_ok($$select public.request_connection('Res One', 'T-0001', 'Self', 'x')$$, '42501', null, 'resident cannot request connections');
select is((select count(*)::int from public.connection_requests), 0, 'resident cannot read requests');
reset role;

-- other facility staff
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.connection_requests), 0, 'other facility staff cannot see requests');
select throws_ok($$select public.decide_connection((select id from public.connection_requests where false), true)$$, 'P0002', null, 'decide on unknown request fails');
reset role;

-- staff decides
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.connection_requests where status = 'pending'), 2, 'staff sees pending queue');
select throws_ok($$select public.decide_connection((select id from public.connection_requests where resident_id is null), true)$$, 'P0001', 'no matching resident; deny instead', 'cannot approve an unmatched request');
select lives_ok($$select public.decide_connection((select id from public.connection_requests where resident_id is not null), true)$$, 'staff approves matched request');
select throws_ok($$select public.decide_connection((select id from public.connection_requests where resident_id is not null), false, 'x')$$, 'P0001', 'request already decided', 'cannot decide twice');
select lives_ok($$select public.decide_connection((select id from public.connection_requests where resident_id is null), false, 'No such resident')$$, 'staff denies unmatched request');
reset role;
select is((select count(*)::int from public.audit_log where actor_id = 'a1000000-0000-0000-0000-000000000002' and action in ('connection.approve','connection.deny')), 2, 'decisions audited with staff id');

-- visibility after approval
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.list_my_contacts() where name = 'famA'), 1, 'approved resident sees the contact');
select is((select count(*)::int from public.contacts), 1, 'resident reads own contacts');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000006');
select is((select count(*)::int from public.contacts), 0, 'other resident sees no contacts');
reset role;

-- blocking
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.set_contact_status((select id from public.contacts), 'blocked')$$, 'P0002', null, 'other facility staff cannot block');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select lives_ok($$select public.set_contact_status((select id from public.contacts), 'blocked')$$, 'staff can block a contact');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.list_my_contacts()), 0, 'blocked contact disappears for the resident');
reset role;

select * from finish();
rollback;
