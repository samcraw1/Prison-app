begin;
\ir helpers.inc
select * from no_plan();

insert into public.facilities (id, name, slug) values ('11111111-0000-0000-0000-000000000001', 'Alpha County', 'd1');
select tests.mk_user('a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'staff', 'dstaff');
select tests.mk_user('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'family', 'dfam');
select tests.mk_user('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'family', 'dother');
select tests.mk_user('a1000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', 'resident', 'dres');
insert into public.residents (id, facility_id, user_id, booking_number, full_name, must_change_pin) values
  ('d2000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005', 'D-1001', 'Dee Resident', false);
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'Sister');
insert into public.messages (contact_id, facility_id, sender, body, status) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'family', 'hello', 'delivered');
insert into public.connection_requests (facility_id, family_user_id, typed_resident_name, typed_booking_number, relationship, id_photo_path)
  values ('11111111-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'Dee Resident', 'D-1001', 'Sister',
          '11111111-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000003/id.jpg');
insert into public.push_tokens (token, user_id, platform) values ('ExpoPushToken[dfam-device-00001]', 'a1000000-0000-0000-0000-000000000003', 'ios');
set local role service_role;
select public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 1000, 'usd', 'pi_del1', 'evt_del1');
reset role;

-- ---------------------------------------------------------------- request / cancel
select tests.as_user('a1000000-0000-0000-0000-000000000001');
select throws_ok($$select public.request_account_deletion()$$, '42501', null, 'staff cannot request family deletion');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is(public.my_deletion(), null, 'no deletion pending at first');
select ok(public.request_account_deletion() between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour',
  'deletion is scheduled about 30 days out');
select is(public.request_account_deletion(), public.my_deletion(), 'asking again does not move the date');
select lives_ok($$select public.cancel_account_deletion()$$, 'family can cancel during the grace period');
select is(public.my_deletion(), null, 'cancelled');
select public.request_account_deletion();
reset role;

-- ---------------------------------------------------------------- erasure
set local role service_role;
select is((select count(*)::int from public.accounts_due_for_erasure()), 0, 'not due during grace period');
select throws_ok($$select public.erase_family_account('a1000000-0000-0000-0000-000000000003')$$,
  'P0001', 'deletion is not due', 'cannot erase before the grace period ends');
select throws_ok($$select public.erase_family_account('a1000000-0000-0000-0000-000000000005')$$,
  '22023', null, 'only family accounts can be erased');
reset role;
update public.users set deletion_scheduled_for = now() - interval '1 minute', deletion_requested_at = now() - interval '30 days'
 where id = 'a1000000-0000-0000-0000-000000000003';
set local role service_role;
select is((select count(*)::int from public.accounts_due_for_erasure()), 1, 'due after the grace period');
select is(public.erase_family_account('a1000000-0000-0000-0000-000000000003'), 'erased', 'account erased');
select is(public.erase_family_account('a1000000-0000-0000-0000-000000000003'), 'already_erased', 'erasing twice is a no-op');
reset role;

select is((select full_name from public.users where id = 'a1000000-0000-0000-0000-000000000003'), 'Deleted user', 'name removed');
select is((select email from public.users where id = 'a1000000-0000-0000-0000-000000000003'),
  'deleted+a1000000-0000-0000-0000-000000000003@invalid', 'email removed');
select is((select status::text from public.users where id = 'a1000000-0000-0000-0000-000000000003'), 'deleted', 'status deleted');
select is((select count(*)::int from public.push_tokens where user_id = 'a1000000-0000-0000-0000-000000000003'), 0, 'push tokens removed');
select is((select id_photo_path from public.connection_requests where family_user_id = 'a1000000-0000-0000-0000-000000000003'),
  'erased', 'ID photo reference removed');
select is((select status::text from public.contacts where id = 'c0000000-0000-0000-0000-000000000001'), 'blocked', 'connection closed');
select is((select count(*)::int from public.messages where contact_id = 'c0000000-0000-0000-0000-000000000001'), 1, 'messages kept');
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 1000::bigint, 'ledger untouched');
select is((select count(*)::int from public.audit_log where action = 'account.erased'), 1, 'erasure is audited');
select is((select count(*)::int from public.users where id = 'a1000000-0000-0000-0000-000000000004' and status = 'active'), 1, 'other accounts untouched');

-- an erased account has no access
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is(public.my_deletion(), null, 'erased account has nothing pending');
select throws_ok($$select public.request_account_deletion()$$, '42501', null, 'erased account cannot act');
reset role;

select * from finish();
rollback;
