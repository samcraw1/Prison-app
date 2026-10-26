-- Step 6: audit exports are themselves audited.
create function public.log_audit_export(p_filters jsonb, p_rows int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  perform public.log_action(public.auth_facility(), 'audit.export', 'audit_log', null,
    jsonb_build_object('filters', coalesce(p_filters, '{}'::jsonb), 'rows', p_rows));
end $$;
revoke execute on function public.log_audit_export(jsonb, int) from public, anon;
grant execute on function public.log_audit_export(jsonb, int) to authenticated;

create index audit_log_action_idx on public.audit_log (facility_id, action, created_at desc);
