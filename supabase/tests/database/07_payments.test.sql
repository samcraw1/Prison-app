begin;
\ir helpers.inc
select * from no_plan();

-- F1: family home facility (deposits land here). F2: the resident's facility (sets prices, receives fees).
insert into public.facilities (id, name, slug) values
  ('11111111-0000-0000-0000-000000000001', 'Alpha County', 'p1'),
  ('22222222-0000-0000-0000-000000000002', 'Bravo County', 'p2');
select tests.mk_user('a1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'staff', 'p1staff');
select tests.mk_user('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'family', 'payA');
select tests.mk_user('a1000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'family', 'payB');
select tests.mk_user('b2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'staff', 'p2staff');
select tests.mk_user('b2000000-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000002', 'resident', 'payres');
insert into public.residents (id, facility_id, user_id, booking_number, full_name, must_change_pin) values
  ('d2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000005', 'P-1001', 'Pat Payne', false);
insert into public.contacts (id, facility_id, resident_id, family_user_id, relationship) values
  ('c0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'Sister');
insert into public.visit_slots (id, facility_id, starts_at, ends_at, capacity) values
  ('e0000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 30 minutes', 5),
  ('e0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', now() + interval '2 day', now() + interval '2 day 30 minutes', 5),
  ('e0000000-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', now() + interval '3 day', now() + interval '3 day 30 minutes', 5),
  ('e0000000-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000002', now() + interval '4 day', now() + interval '4 day 30 minutes', 5);
insert into public.push_tokens (token, user_id, platform) values ('ExpoPushToken[payA-device-0001]', 'a1000000-0000-0000-0000-000000000003', 'ios');

-- ---------------------------------------------------------------- rate card validation
select throws_ok($$update public.facilities set settings = settings || '{"message_fee_cents": 9999}' where slug = 'p2'$$,
  '23514', null, 'message fee above the sanity cap is rejected');
select throws_ok($$update public.facilities set settings = settings || '{"visit_fee_cents": -5}' where slug = 'p2'$$,
  '23514', null, 'negative visit fee is rejected');
select throws_ok($$update public.facilities set settings = settings || '{"free_messages_per_week": "lots"}' where slug = 'p2'$$,
  '23514', null, 'non-numeric free allowance is rejected');
select lives_ok($$update public.facilities set settings = settings || '{"message_fee_cents": 25, "visit_fee_cents": 300, "free_messages_per_week": 1, "max_visits_per_week": 14}' where slug = 'p2'$$,
  'valid rate card is accepted');
select is((select message_fee_cents from public.rate_card('11111111-0000-0000-0000-000000000001')), 0, 'missing rate card means free');

-- ---------------------------------------------------------------- charging messages
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select is(public.my_balance(), 0::bigint, 'new family balance is 0');
select results_eq($$select message_fee_cents, visit_fee_cents, free_messages_left from public.contact_prices('c0000000-0000-0000-0000-000000000001')$$,
  $$values (25, 300, 1)$$, 'prices come from the resident''s facility');
select lives_ok($$select public.send_message('c0000000-0000-0000-0000-000000000001', 'free one')$$, 'first message this week is free');
select is((select fee_cents from public.messages where body = 'free one'), 0, 'free message records fee 0');
select throws_ok($$select public.send_message('c0000000-0000-0000-0000-000000000001', 'no money')$$,
  'P0001', 'insufficient balance; add funds to continue', 'paid message without balance is blocked');
select ok(not exists (select 1 from public.messages where body = 'no money'), 'blocked message was not stored');
select throws_ok($$select public.request_visit('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'insufficient balance; add funds to continue', 'paid visit without balance is blocked');
select is((select count(*)::int from public.visits), 0, 'blocked visit was not stored');
reset role;

-- ---------------------------------------------------------------- client lockdown
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select throws_ok($$insert into public.ledger_entries (family_user_id, facility_id, kind, amount_cents, reference)
  values ('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'deposit', 100000, 'pi_free')$$,
  '42501', null, 'families cannot insert ledger rows');
select throws_ok($$select public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 5000, 'usd', 'pi_self', 'evt_self')$$,
  '42501', null, 'families cannot call record_deposit');
select throws_ok($$select public.ledger_post('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'deposit', 5000, 'pi_x')$$,
  '42501', null, 'families cannot call ledger_post');
select throws_ok($$select public.record_stripe_reversal('pi_x', 'dispute_reinstated', 'du_x', 5000, 'evt_x')$$,
  '42501', null, 'families cannot call record_stripe_reversal');
select throws_ok($$select public.wallet_balance('a1000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'families cannot read another balance');
select throws_ok($$select public.ledger_refund('message_fee', 'message:x', 'x')$$, '42501', null, 'families cannot call ledger_refund');
reset role;
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select throws_ok($$select public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 5000, 'usd', 'pi_staff', 'evt_staff')$$,
  '42501', null, 'staff cannot call record_deposit');
select throws_ok($$update public.messages set fee_cents = 0$$, '42501', null, 'staff cannot change message fees');
reset role;
select tests.as_anon();
select throws_ok($$select public.my_balance()$$, '42501', null, 'anon cannot read balances');
reset role;

-- ---------------------------------------------------------------- deposits (service role, from the webhook)
set local role service_role;
select is(public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 1000, 'usd', 'pi_A1', 'evt_dep_1'),
  'credited', 'deposit is credited');
select is(public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 1000, 'usd', 'pi_A1', 'evt_dep_1'),
  'duplicate', 'replayed event credits once');
select is(public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 1000, 'usd', 'pi_A1', 'evt_dep_other'),
  'duplicate', 'a second event for the same payment credits once');
select throws_ok($$select public.record_deposit('b2000000-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000002', 1000, 'usd', 'pi_res', 'evt_res')$$,
  '22023', null, 'only family accounts can receive deposits');
select throws_ok($$select public.record_deposit('a1000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 1000, 'eur', 'pi_eur', 'evt_eur')$$,
  '22023', null, 'only USD deposits');
reset role;
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 1000::bigint, 'balance is 1000 after one deposit');
select ok(exists (select 1 from public.push_outbox where user_id = 'a1000000-0000-0000-0000-000000000003' and title = 'Funds added' and body !~ '[0-9]'),
  'deposit pushes "Funds added" without an amount');

-- ---------------------------------------------------------------- paid message and visit
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select lives_ok($$select public.send_message('c0000000-0000-0000-0000-000000000001', 'paid one')$$, 'paid message is sent once funded');
select is((select fee_cents from public.messages where body = 'paid one'), 25, 'message records its fee');
select is(public.my_balance(), 975::bigint, 'message fee debited');
select is((select facility_id from public.ledger_entries where kind = 'message_fee'), '22222222-0000-0000-0000-000000000002'::uuid,
  'fee belongs to the resident''s facility');
select lives_ok($$select public.request_visit('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001')$$, 'paid visit is requested');
select is((select fee_cents from public.visits where slot_id = 'e0000000-0000-0000-0000-000000000001'), 300, 'visit records its fee');
select is(public.my_balance(), 675::bigint, 'visit fee debited');
reset role;

-- resident messages are never charged
select tests.as_user('b2000000-0000-0000-0000-000000000005');
select lives_ok($$select public.send_message('c0000000-0000-0000-0000-000000000001', 'hi from inside')$$, 'resident can send');
select is((select fee_cents from public.messages where body = 'hi from inside'), 0, 'resident message is free');
select is((select count(*)::int from public.ledger_entries), 0, 'residents see no ledger rows');
reset role;

-- ---------------------------------------------------------------- refunds
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.review_message((select id from public.messages where body = 'paid one'), 'reject', 'not allowed')$$, 'staff reject the paid message');
select lives_ok($$select public.decide_visit((select id from public.visits where slot_id = 'e0000000-0000-0000-0000-000000000001'), false, 'no')$$, 'staff deny the paid visit');
reset role;
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 1000::bigint, 'rejected message and denied visit are refunded');
select is((select count(*)::int from public.ledger_entries where kind = 'refund'), 2, 'two refund entries');

-- free (unpaid) message rejected: nothing to refund
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select lives_ok($$select public.review_message((select id from public.messages where body = 'free one'), 'reject', 'x')$$, 'reject free message');
reset role;
select is((select count(*)::int from public.ledger_entries where kind = 'refund'), 2, 'no refund for a free message');

-- family cancels
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select public.request_visit('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002');
select is(public.my_balance(), 700::bigint, 'second visit charged');
select lives_ok($$select public.cancel_visit((select id from public.visits where slot_id = 'e0000000-0000-0000-0000-000000000002'))$$, 'family cancels');
select is(public.my_balance(), 1000::bigint, 'cancelled visit refunded');
-- approved, then nobody joined
select public.request_visit('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003');
-- went live and ended
select public.request_visit('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004');
reset role;
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 400::bigint, 'two more visits charged');
update public.visits set status = 'approved' where slot_id in ('e0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004');
update public.visits set status = 'cancelled', end_reason = 'no_show' where slot_id = 'e0000000-0000-0000-0000-000000000003';
update public.visits set status = 'live' where slot_id = 'e0000000-0000-0000-0000-000000000004';
update public.visits set status = 'ended', end_reason = 'staff' where slot_id = 'e0000000-0000-0000-0000-000000000004';
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 700::bigint, 'no-show refunded, completed visit kept');
select is(public.ledger_refund('visit_fee', 'visit:' || (select id from public.visits where slot_id = 'e0000000-0000-0000-0000-000000000003'), 'again'),
  null, 'a fee is refunded at most once');
select throws_ok($$update public.visits set fee_cents = 0 where slot_id = 'e0000000-0000-0000-0000-000000000004'$$,
  'P0001', 'fee_cents cannot change', 'recorded visit fee cannot change');

-- ---------------------------------------------------------------- Stripe reversals
set local role service_role;
select is(public.record_stripe_reversal('pi_A1', 'refund', 're_1', 400, 'evt_re_1'), 'recorded', 'card refund recorded');
select is(public.record_stripe_reversal('pi_A1', 'refund', 're_1', 400, 'evt_re_1'), 'duplicate', 'card refund replay ignored');
select is(public.record_stripe_reversal('pi_A1', 'dispute_withdrawn', 'du_1', 600, 'evt_du_1'), 'recorded', 'dispute withdrawal recorded');
select is(public.record_stripe_reversal('pi_unknown', 'refund', 're_2', 100, 'evt_re_2'), 'unknown_payment', 'unknown payment is reported');
reset role;
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), -300::bigint, 'balance can go negative after reversals');
select tests.as_user('a1000000-0000-0000-0000-000000000003');
-- (the free message was rejected, so this week's free message is available again)
select lives_ok($$select public.send_message('c0000000-0000-0000-0000-000000000001', 'free again')$$, 'rejected messages do not use up the free allowance');
select throws_ok($$select public.request_visit('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002')$$,
  'P0001', 'insufficient balance; add funds to continue', 'negative balance blocks fees');
reset role;
set local role service_role;
select is(public.record_stripe_reversal('pi_A1', 'dispute_reinstated', 'du_1', 600, 'evt_du_2'), 'recorded', 'dispute reinstatement recorded');
reset role;
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 300::bigint, 'reinstated funds return');

-- Reversal hardening (20261108000004): dp_ ids, and credits only undo debits that were recorded. Each pair nets to zero.
set local role service_role;
select is(public.record_stripe_reversal('pi_A1', 'dispute_withdrawn', 'dp_1', 50, 'evt_dp_1'), 'recorded', 'dp_ dispute id accepted');
select is(public.record_stripe_reversal('pi_A1', 'dispute_reinstated', 'dp_1', 50, 'evt_dp_2'), 'recorded', 'dp_ dispute reinstated');
select throws_ok($$select public.record_stripe_reversal('pi_A1', 'refund_failed', 're_never', 100, 'evt_f_0')$$,
  'P0001', null, 'refund_failed without a recorded refund is rejected (Stripe retries)');
select throws_ok($$select public.record_stripe_reversal('pi_A1', 'dispute_reinstated', 'dp_never', 100, 'evt_r_0')$$,
  'P0001', null, 'dispute_reinstated without a recorded withdrawal is rejected (Stripe retries)');
select is(public.record_stripe_reversal('pi_A1', 'refund', 're_3', 100, 'evt_re_3'), 'recorded', 'second card refund recorded');
select is(public.record_stripe_reversal('pi_A1', 'refund_failed', 're_3', 100, 'evt_f_1'), 'recorded', 'failed refund credits back once its debit exists');
select is(public.record_stripe_reversal('pi_A1', 'refund_failed', 're_3', 100, 'evt_f_1'), 'duplicate', 'failed refund replay ignored');
select throws_ok($$select public.record_stripe_reversal('pi_A1', 'bogus', 're_3', 100, 'evt_b_1')$$,
  '22023', 'unknown reversal kind', 'unknown reversal kind is rejected');
reset role;
select is(public.wallet_balance('a1000000-0000-0000-0000-000000000003'), 300::bigint, 'hardening cases net to zero');

-- ---------------------------------------------------------------- immutability
select throws_ok($$update public.ledger_entries set amount_cents = 100000$$, 'P0001', 'ledger_entries is append-only', 'ledger rows cannot be updated');
select throws_ok($$delete from public.ledger_entries$$, 'P0001', 'ledger_entries is append-only', 'ledger rows cannot be deleted');
select throws_ok($$truncate public.ledger_entries$$, 'P0001', 'ledger_entries is append-only', 'ledger cannot be truncated');

-- ---------------------------------------------------------------- RLS isolation
select tests.as_user('a1000000-0000-0000-0000-000000000003');
select ok((select count(*) from public.ledger_entries) > 5, 'family sees their own entries');
select is((select count(*)::int from public.ledger_entries where family_user_id <> auth.uid()), 0, 'family sees only their own entries');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.ledger_entries), 0, 'another family sees nothing');
select is(public.my_balance(), 0::bigint, 'another family''s balance is their own');
reset role;
select tests.as_user('b2000000-0000-0000-0000-000000000001');
select ok((select count(*) from public.ledger_entries) > 0, 'resident-facility staff see fees charged at their facility');
select is((select count(*)::int from public.ledger_entries where facility_id <> '22222222-0000-0000-0000-000000000002'), 0,
  'resident-facility staff see only their facility');
select is((select count(*)::int from public.ledger_entries where kind = 'deposit'), 0, 'deposits made at another facility are not visible');
reset role;
select tests.as_user('a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.ledger_entries where kind = 'deposit'), 1, 'home-facility staff see the deposit');
select is((select count(*)::int from public.ledger_entries where kind in ('message_fee', 'visit_fee')), 0, 'home-facility staff do not see other facilities'' fees');
reset role;

-- ---------------------------------------------------------------- audit
select is((select count(*)::int from public.ledger_entries), (select count(*)::int from public.audit_log where action like 'ledger.%'),
  'every ledger entry is in the audit log');
select ok(exists (select 1 from public.audit_log where action = 'ledger.deposit' and actor_id = 'a1000000-0000-0000-0000-000000000003'),
  'webhook deposits are attributed to the family member');

select * from finish();
rollback;
