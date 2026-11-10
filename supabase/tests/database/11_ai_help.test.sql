begin;
\ir helpers.inc
select * from no_plan();

-- Two facilities: Home (help bot on) and Other (help bot on, but the family has no connection there).
insert into public.facilities (id, name, slug, settings) values
  ('11111111-0000-0000-0000-000000000011', 'Home County', 'h11',
   '{"hold_all_messages": true, "max_visit_minutes": 30, "max_visits_per_week": 2, "visit_fee_cents": 250, "help_bot_enabled": true}'),
  ('11111111-0000-0000-0000-000000000012', 'Other County', 'h12',
   '{"hold_all_messages": true, "max_visit_minutes": 30, "max_visits_per_week": 2, "help_bot_enabled": true}');
select tests.mk_user('ab000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000011', 'staff', 'hstaff');
select tests.mk_user('ab000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000012', 'staff', 'ostaff');
select tests.mk_user('ab000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000011', 'family', 'hfam');
select tests.mk_user('ab000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000011', 'resident', 'hres');
insert into public.residents (id, facility_id, user_id, booking_number, full_name, must_change_pin) values
  ('db000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000011', 'ab000000-0000-0000-0000-000000000004', 'H-1001', 'Secret Resident Name', false);
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('cb000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000011', 'db000000-0000-0000-0000-000000000001', 'ab000000-0000-0000-0000-000000000003', 'Brother');

-- ---------------------------------------------------------------- settings constraint
select lives_ok($$update public.facilities set settings = settings || '{"translation_enabled": false, "ai_review_enabled": true}' where id = '11111111-0000-0000-0000-000000000012'$$,
  'AI switches accept booleans');
select throws_ok($$update public.facilities set settings = settings || '{"help_bot_enabled": "yes"}' where id = '11111111-0000-0000-0000-000000000012'$$,
  '23514', null, 'help_bot_enabled must be a boolean');
select throws_ok($$update public.facilities set settings = settings || '{"ai_review_enabled": 1}' where id = '11111111-0000-0000-0000-000000000012'$$,
  '23514', null, 'ai_review_enabled must be a boolean');
-- earlier rules still hold
select throws_ok($$update public.facilities set settings = settings || '{"hold_all_messages": "yes"}' where id = '11111111-0000-0000-0000-000000000012'$$,
  '23514', null, 'hold_all_messages must still be a boolean');
select throws_ok($$update public.facilities set settings = settings || '{"max_visits_per_week": 0}' where id = '11111111-0000-0000-0000-000000000012'$$,
  '23514', null, 'weekly visit limit still enforced');
select throws_ok($$update public.facilities set settings = settings || '{"max_visit_minutes": 500}' where id = '11111111-0000-0000-0000-000000000012'$$,
  '23514', null, 'visit length limit still enforced');
select throws_ok($$update public.facilities set settings = settings || '{"message_fee_cents": 9999}' where id = '11111111-0000-0000-0000-000000000012'$$,
  '23514', null, 'rate card limit still enforced');
select is((select settings ? 'help_bot_enabled' from public.facilities f
            where f.id not in ('11111111-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000012') limit 1),
  false, 'existing facilities have no help switch (off by default)');

-- ---------------------------------------------------------------- grants
select ok(not has_table_privilege('anon', 'public.facility_help', 'select'), 'anon cannot read facility_help');
select ok(has_table_privilege('authenticated', 'public.facility_help', 'select'), 'authenticated may select facility_help (RLS limits rows)');
select ok(not has_table_privilege('authenticated', 'public.facility_help', 'insert'), 'no direct insert on facility_help');
select ok(not has_table_privilege('authenticated', 'public.facility_help', 'update'), 'no direct update on facility_help');
select ok(not has_table_privilege('authenticated', 'public.facility_help', 'delete'), 'no direct delete on facility_help');
select ok(not has_table_privilege('authenticated', 'public.help_usage', 'select'), 'no client access to help_usage');
select ok(not has_table_privilege('authenticated', 'public.help_usage', 'insert'), 'no client insert on help_usage');
select ok(not has_table_privilege('anon', 'public.help_usage', 'select'), 'anon cannot read help_usage');
select ok(not has_function_privilege('anon', 'public.help_context()', 'execute'), 'anon cannot call help_context');
select ok(not has_function_privilege('anon', 'public.take_help_question()', 'execute'), 'anon cannot call take_help_question');
select ok(not has_function_privilege('authenticated', 'public.purge_ai_data()', 'execute'), 'clients cannot purge');
select ok(has_function_privilege('service_role', 'public.purge_ai_data()', 'execute'), 'service role can purge');
select ok(not has_function_privilege('authenticated', 'public.help_usage_on_erase()', 'execute'), 'erase trigger function not callable');

-- ---------------------------------------------------------------- staff edit their FAQ
select tests.as_user('ab000000-0000-0000-0000-000000000001');
select lives_ok($$select public.save_facility_help(null, 'What ID do visitors need?', 'A state ID.')$$, 'staff add an entry');
select is((select count(*) from public.facility_help)::int, 1, 'staff see their entry');
select lives_ok($$select public.save_facility_help((select id from public.facility_help limit 1), 'What ID do visitors need?', 'A state ID or passport.')$$, 'staff edit an entry');
select is((select answer from public.facility_help limit 1), 'A state ID or passport.', 'edit saved');
select throws_ok($$select public.save_facility_help(null, 'x', 'too short question')$$, '23514', null, 'question length checked');
reset role;
select is((select count(*) from public.audit_log where action in ('help.add', 'help.update'))::int, 2, 'FAQ edits audited');

select tests.as_user('ab000000-0000-0000-0000-000000000002');
select lives_ok($$select public.save_facility_help(null, 'Other parking?', 'Lot B.')$$, 'other facility staff add their own');
select is((select count(*) from public.facility_help)::int, 1, 'other staff see only their own facility');
reset role;
create temp table t_home_help as select id from public.facility_help where question like 'What ID%';
grant select on t_home_help to authenticated;
select tests.as_user('ab000000-0000-0000-0000-000000000002');
select throws_ok($$select public.save_facility_help((select id from t_home_help), 'Hijack question', 'x')$$, 'P0002', null, 'cannot edit another facility''s entry');
select throws_ok($$select public.delete_facility_help((select id from t_home_help))$$, 'P0002', null, 'cannot delete another facility''s entry');
reset role;

select tests.as_user('ab000000-0000-0000-0000-000000000003');
select throws_ok($$select public.save_facility_help(null, 'Family question?', 'x')$$, '42501', null, 'family cannot edit the FAQ');
select is((select count(*) from public.facility_help)::int, 0, 'family cannot read facility_help directly');
select throws_ok($$select * from public.help_usage$$, '42501', null, 'family cannot read help_usage');

-- ---------------------------------------------------------------- what the bot may know
select is(public.help_available(), true, 'help available for the home facility');
select is(jsonb_array_length(public.help_context()), 1, 'context covers only connected facilities');
select is(public.help_context()->0->>'facility', 'Home County', 'context names the facility');
select is((public.help_context()->0->'policies'->>'visit_fee_cents')::int, 250, 'context includes the rate card');
select is(public.help_context()->0->'faq'->0->>'q', 'What ID do visitors need?', 'context includes the facility FAQ');
select ok(public.help_context()::text not like '%Secret Resident Name%' and public.help_context()::text not like '%H-1001%',
  'context carries no resident data');
select ok(public.help_context()::text not like '%Other parking%', 'unconnected facility FAQ is not included');

-- daily limit
select is(public.take_help_question(), true, 'first question counted');
reset role;
update public.help_usage set count = 29 where user_id = 'ab000000-0000-0000-0000-000000000003';
select tests.as_user('ab000000-0000-0000-0000-000000000003');
select is(public.take_help_question(), true, '30th question allowed');
select is(public.take_help_question(), false, '31st question refused');
reset role;
select is((select count from public.help_usage where user_id = 'ab000000-0000-0000-0000-000000000003'), 30, 'refused question is not counted');

-- report: ids only
select tests.as_user('ab000000-0000-0000-0000-000000000003');
select lives_ok($$select public.report_help_answer()$$, 'family can report an answer');
reset role;
select is((select detail from public.audit_log where action = 'help.report' order by created_at desc limit 1), '{}'::jsonb, 'report stores no text');

-- staff, residents: no bot
select tests.as_user('ab000000-0000-0000-0000-000000000001');
select is(public.help_available(), false, 'staff have no help bot');
select throws_ok($$select public.take_help_question()$$, '42501', null, 'staff cannot use the bot');
reset role;
select tests.as_user('ab000000-0000-0000-0000-000000000004');
select is(public.help_available(), false, 'residents have no help bot');
select is(jsonb_array_length(public.help_context()), 0, 'residents get no context');
select throws_ok($$select public.take_help_question()$$, '42501', null, 'residents cannot use the bot');
select throws_ok($$select public.report_help_answer()$$, '42501', null, 'residents cannot report');
reset role;

-- switched off: unavailable
update public.facilities set settings = settings || '{"help_bot_enabled": false}' where id = '11111111-0000-0000-0000-000000000011';
select tests.as_user('ab000000-0000-0000-0000-000000000003');
select is(public.help_available(), false, 'off when the facility turns it off');
select is(jsonb_array_length(public.help_context()), 0, 'no context when off');
reset role;

-- ---------------------------------------------------------------- retention and erasure
insert into public.help_usage (user_id, day, count) values ('ab000000-0000-0000-0000-000000000003', current_date - 31, 5);
select is((public.purge_ai_data()->>'help_usage')::int, 1, 'purge removes counters older than 30 days');
select is((select count(*) from public.help_usage where user_id = 'ab000000-0000-0000-0000-000000000003')::int, 1, 'today''s counter kept');
update public.users set status = 'deleted' where id = 'ab000000-0000-0000-0000-000000000003';
select is((select count(*) from public.help_usage where user_id = 'ab000000-0000-0000-0000-000000000003')::int, 0, 'erased account loses its counters');

select * from finish();
rollback;
