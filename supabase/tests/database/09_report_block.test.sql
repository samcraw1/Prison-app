begin;
\ir helpers.inc
select * from no_plan();

insert into public.facilities (id, name, slug) values ('11111111-0000-0000-0000-000000000009', 'Beta County', 'rb');
select tests.mk_user('a9000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000009', 'staff', 'rstaff');
select tests.mk_user('a9000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000009', 'family', 'rfam');
select tests.mk_user('a9000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000009', 'family', 'rother');
select tests.mk_user('a9000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000009', 'resident', 'rres');
insert into public.residents (id, facility_id, user_id, booking_number, full_name, must_change_pin) values
  ('d9000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000009', 'a9000000-0000-0000-0000-000000000005', 'R-1001', 'Rae Resident', false);
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('c9000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000009', 'd9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003', 'Sister');
insert into public.messages (id, contact_id, facility_id, sender, body, status) values
  ('e9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000009', 'resident', 'hi', 'delivered'),
  ('e9000000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000009', 'resident', 'held one', 'held');

select tests.as_user('a9000000-0000-0000-0000-000000000004');
select throws_ok($$select public.report_content('c9000000-0000-0000-0000-000000000001', null, 'spam')$$, '42501', null, 'another family cannot report on this contact');
select throws_ok($$select public.block_contact('c9000000-0000-0000-0000-000000000001')$$, '42501', null, 'another family cannot block this contact');
reset role;

select tests.as_user('a9000000-0000-0000-0000-000000000003');
select throws_ok($$select public.report_content('c9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000002', 'spam')$$, '42501', null, 'cannot report an undelivered message');
select throws_ok($$select public.report_content('c9000000-0000-0000-0000-000000000001', null, 'bogus')$$, '23514', null, 'reason must be known');
select lives_ok($$select public.report_content('c9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'harassment', 'rude')$$, 'family can report a delivered message');
select is((select count(*) from public.content_reports)::int, 0, 'family cannot read the reports table');
select is((select count(*) from public.list_my_contacts())::int, 1, 'contact listed before block');
select lives_ok($$select public.block_contact('c9000000-0000-0000-0000-000000000001')$$, 'family can block');
select is((select count(*) from public.list_my_contacts())::int, 0, 'blocked contact is hidden');
select is((select count(*) from public.list_blocked_contacts())::int, 1, 'blocked contact is listed under blocked');
select is((select count(*) from public.messages)::int, 0, 'blocked conversation is hidden');
reset role;

select tests.as_user('a9000000-0000-0000-0000-000000000005');
select throws_ok($$select public.send_message('c9000000-0000-0000-0000-000000000001', 'hello?')$$, '42501', null, 'resident cannot message a blocked contact');
reset role;

select tests.as_user('a9000000-0000-0000-0000-000000000001');
select is((select count(*) from public.content_reports where status = 'open')::int, 1, 'staff see the open report');
select lives_ok($$select public.resolve_report((select id from public.content_reports limit 1))$$, 'staff can resolve');
select is((select count(*) from public.content_reports where status = 'open')::int, 0, 'report resolved');
select is((select count(*) from public.audit_log where action in ('report.create','report.resolve','contact.family_block'))::int, 3, 'actions are audited');
reset role;

select tests.as_user('a9000000-0000-0000-0000-000000000003');
select lives_ok($$select public.unblock_contact('c9000000-0000-0000-0000-000000000001')$$, 'family can unblock');
select is((select count(*) from public.list_my_contacts())::int, 1, 'contact is back after unblock');
reset role;

select * from finish();
rollback;
