begin;
\ir helpers.inc
select * from no_plan();

insert into public.facilities (id, name, slug) values ('11111111-0000-0000-0000-00000000000a', 'Gamma County', 'iv');
select tests.mk_user('aa000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000000a', 'staff', 'istaff');
select tests.mk_user('aa000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-00000000000a', 'family', 'ifam');
select tests.mk_user('aa000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-00000000000a', 'family', 'iother');
select tests.mk_user('aa000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-00000000000a', 'resident', 'ires');
insert into public.residents (id, facility_id, user_id, booking_number, full_name, must_change_pin) values
  ('da000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000000a', 'aa000000-0000-0000-0000-000000000005', 'I-1001', 'Ivy Resident', false);
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('ca000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000000a', 'da000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000003', 'Sister');

select tests.as_user('aa000000-0000-0000-0000-000000000004');
select throws_ok($$select public.request_instant_visit('ca000000-0000-0000-0000-000000000001')$$, '42501', null, 'another family cannot call this contact');
reset role;

select tests.as_user('aa000000-0000-0000-0000-000000000001');
select throws_ok($$select public.request_instant_visit('ca000000-0000-0000-0000-000000000001')$$, '42501', null, 'staff cannot use it');
reset role;

select tests.as_user('aa000000-0000-0000-0000-000000000003');
select lives_ok($$select public.request_instant_visit('ca000000-0000-0000-0000-000000000001')$$, 'family can call now');
select is((select status::text from public.visits limit 1), 'requested', 'it is a normal request awaiting staff');
select ok((select s.starts_at from public.visits v join public.visit_slots s on s.id = v.slot_id limit 1) between now() + interval '8 minutes' and now() + interval '11 minutes', 'starts in about ten minutes');
select is((select count(*) from public.list_open_slots())::int, 0, 'the on-demand slot is not offered to others');
select throws_ok($$select public.request_instant_visit('ca000000-0000-0000-0000-000000000001')$$, 'P0001', null, 'no second call while one is pending');
reset role;

select tests.as_user('aa000000-0000-0000-0000-000000000001');
select lives_ok($$select public.decide_visit((select id from public.visits limit 1), true)$$, 'staff can approve it');
reset role;

select * from finish();
rollback;
