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
insert into public.flag_keywords (facility_id, word) values ('11111111-0000-0000-0000-000000000001', 'weapon');

-- default setting: hold everything --------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'Hi love, hope you are well')$$, 'family can message an approved contact');
select is((select status::text from public.messages), 'held', 'hold-all setting holds new messages');
select is((select count(*)::int from public.messages), 1, 'sender sees own held message');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000002', 'to someone else''s contact')$$, '42501', null, 'cannot message a contact that is not yours');
select throws_ok($$insert into public.messages (facility_id, contact_id, sender, body, status) values ('11111111-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','family','x','delivered')$$, '42501', null, 'clients cannot insert messages directly');
select throws_ok($$update public.messages set status = 'delivered'$$, '42501', null, 'clients cannot update messages');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', '   ')$$, '22023', null, 'empty message rejected');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', repeat('x', 2001))$$, '22023', null, 'oversized message rejected');
select throws_ok($$select public.review_message((select id from public.messages), 'approve')$$, '42501', null, 'family cannot review messages');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'with file', 'bogus/path.png')$$, '22023', null, 'invalid attachment path rejected');
reset role;

select tests.as_user('a1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.messages), 0, 'resident cannot see held messages');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.messages), 0, 'other family cannot see messages');
reset role;

-- staff review ------------------------------------------------------------------------------
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.review_message((select id from public.messages where false), 'approve')$$, 'P0002', null, 'unknown message');
select is((select count(*)::int from public.messages), 0, 'other facility staff sees no messages');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.messages where status = 'held'), 1, 'staff sees held queue');
select lives_ok($$select public.review_message((select id from public.messages), 'approve')$$, 'staff approves');
select throws_ok($$select public.review_message((select id from public.messages), 'approve')$$, 'P0001', null, 'cannot approve twice');
reset role;
select is((select status::text from public.messages), 'delivered', 'approved message is delivered');
select is((select count(*)::int from public.audit_log where action = 'message.approve' and actor_id = 'a1000000-0000-0000-0000-000000000002'), 1, 'approval audited with staff id');
select is((select count(*)::int from public.message_reviews where action = 'approve'), 1, 'review row recorded');

select tests.as_user('a1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.messages), 1, 'resident sees delivered message');
select lives_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'Miss you mom')$$, 'resident can reply');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'x', 'a/b/c.png')$$, '42501', null, 'resident cannot attach files');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000002', 'wrong contact')$$, '42501', null, 'resident cannot use another resident''s contact');
select is((select count(*)::int from public.message_reviews), 0, 'resident cannot read reviews');
reset role;

-- reject needs a reason ----------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select throws_ok($$select public.review_message((select id from public.messages where sender = 'resident'), 'reject')$$, '22023', null, 'reject requires reason');
select lives_ok($$select public.review_message((select id from public.messages where sender = 'resident'), 'reject', 'Not allowed')$$, 'reject with reason');
select lives_ok($$select public.review_message((select id from public.messages where sender = 'family'), 'flag', 'check later')$$, 'staff can flag');
reset role;
select is((select status::text from public.messages where sender = 'resident'), 'rejected', 'rejected status stored');
select is((select flagged from public.messages where sender = 'family'), true, 'flag stored');
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.message_reviews), 0, 'family cannot read reviews');
reset role;

-- auto-deliver + keyword flagging ---------------------------------------------------------------
update public.facilities set settings = settings || '{"hold_all_messages": false}' where id = '11111111-0000-0000-0000-000000000001';
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select public.send_message('d1000000-0000-0000-0000-000000000001', 'Plain note');
select public.send_message('d1000000-0000-0000-0000-000000000001', 'He had a Weapon with him');
select public.send_message('d1000000-0000-0000-0000-000000000001', 'The weaponry museum was fun');
reset role;
select is((select status::text from public.messages where body = 'Plain note'), 'delivered', 'auto-deliver when hold-all is off');
select is((select status::text from public.messages where body like '%Weapon%'), 'held', 'keyword hit is always held');
select is((select flag_reasons from public.messages where body like '%Weapon%'), array['weapon'], 'matched keyword recorded');
select is((select flagged from public.messages where body like '%weaponry%'), false, 'keyword matches whole words only');

-- keyword admin ---------------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.add_keyword('hack')$$, '42501', null, 'family cannot add keywords');
select is((select count(*)::int from public.flag_keywords), 0, 'family cannot read keywords');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select lives_ok($$select public.add_keyword('  Escape ')$$, 'staff adds keyword (normalized)');
select is((select count(*)::int from public.flag_keywords where word = 'escape'), 1, 'keyword normalized to lowercase');
select throws_ok($$select public.add_keyword('bad;word')$$, '23514', null, 'invalid keyword rejected');
reset role;
select is((select count(*)::int from public.audit_log where action = 'keyword.add'), 1, 'keyword add audited');

-- block + suspend ---------------------------------------------------------------------------------------
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select public.set_contact_status('d1000000-0000-0000-0000-000000000001', 'blocked');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'still there?')$$, '42501', null, 'blocked contact cannot send');
select is((select count(*)::int from public.messages), 0, 'blocked contact history is hidden from family');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000002');
select public.set_contact_status('d1000000-0000-0000-0000-000000000001', 'active');
update public.residents set comms_suspended = true where id = 'c1000000-0000-0000-0000-000000000001';
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.messages), 0, 'suspended resident sees no messages');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'hello')$$, 'P0001', 'communication is currently unavailable', 'suspended resident cannot send');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$select public.send_message('d1000000-0000-0000-0000-000000000001', 'to suspended')$$, 'P0001', 'communication is currently unavailable', 'cannot send to suspended resident');
reset role;

select * from finish();
rollback;
