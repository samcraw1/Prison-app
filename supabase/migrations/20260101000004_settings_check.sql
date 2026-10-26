-- Step 4: validate facility settings shape so a bad admin edit cannot break routing or scheduling.
alter table public.facilities
  add constraint facility_settings_valid check (
    jsonb_typeof(settings->'hold_all_messages') = 'boolean'
    and (settings->>'max_visit_minutes') ~ '^[0-9]+$'
    and (settings->>'max_visit_minutes')::int between 5 and 120
    and (settings->>'max_visits_per_week') ~ '^[0-9]+$'
    and (settings->>'max_visits_per_week')::int between 1 and 14
  );
