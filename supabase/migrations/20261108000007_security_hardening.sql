-- Supabase advisor cleanup (security).
-- 1. Trigger functions are never meant to be called as RPCs; the anon/authenticated grants came from the default
--    PUBLIC execute privilege. Triggers do not need the caller to hold EXECUTE.
revoke execute on function public.audit_facility_change(), public.audit_resident_change()
  from public, anon, authenticated;

-- 2. Pin search_path on the remaining functions that did not set one. None of them reference objects outside
--    pg_catalog, which is always searched.
alter function public.ledger_immutable() set search_path = '';
alter function public.audit_log_immutable() set search_path = '';
alter function public.touch_updated_at() set search_path = '';
alter function public.normalize_person_name(text) set search_path = '';
alter function public.fee_cents_immutable() set search_path = '';
