-- Bulk patient register import, so a hospital moving off paper or an old system
-- does not have to retype thousands of patients one dialog at a time.
--
-- Mirrors bulk_import_medicines: admin/reception only, one transaction per
-- call, idempotency key so a retried chunk cannot double-import, and a
-- bulk_import_jobs row plus an audit event for traceability.
--
-- Existing phone numbers are SKIPPED rather than updated. Phone is the visible
-- Patient ID and already carries history, so a spreadsheet must never silently
-- overwrite a live record; the skipped count comes back for the operator.
begin;

create or replace function public.bulk_import_patients(
  p_rows jsonb,
  p_file_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_role public.app_role;
  v_job uuid;
  v_row jsonb;
  v_row_count integer;
  v_created integer := 0;
  v_skipped integer := 0;
  v_exists boolean;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role not in ('admin','reception') then
    raise exception 'forbidden' using errcode='42501';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  -- The browser splits a file into chunks; this is the per-transaction cap.
  if v_row_count < 1 or v_row_count > 1000 then
    raise exception 'row count must be between 1 and 1000';
  end if;

  select id into v_job from public.bulk_import_jobs where idempotency_key = p_idempotency_key;
  if v_job is not null then
    return (
      select jsonb_build_object('job_id', id, 'row_count', row_count,
                                'created', success_count, 'skipped', error_count, 'replayed', true)
      from public.bulk_import_jobs where id = v_job
    );
  end if;

  insert into public.bulk_import_jobs(file_name, row_count, status, idempotency_key)
  values (left(p_file_name, 255), v_row_count, 'processing', p_idempotency_key)
  returning id into v_job;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    select exists(
      select 1 from public.patients where phone_normalized = v_row->>'phone_normalized'
    ) into v_exists;

    if v_exists then
      v_skipped := v_skipped + 1;
    else
      insert into public.patients(name, phone_normalized, gender, dob, blood_group, address, allergies, notes)
      values (
        v_row->>'name',
        v_row->>'phone_normalized',
        (v_row->>'gender')::public.gender,
        nullif(v_row->>'dob','')::date,
        nullif(v_row->>'blood_group',''),
        nullif(v_row->>'address',''),
        nullif(v_row->>'allergies',''),
        nullif(v_row->>'notes','')
      );
      v_created := v_created + 1;
    end if;
  end loop;

  update public.bulk_import_jobs
  set success_count = v_created, error_count = v_skipped, status = 'ready', completed_at = now()
  where id = v_job;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'BULK_PATIENT_IMPORT_COMPLETED', 'bulk_import_job', v_job,
          jsonb_build_object('file_name', p_file_name, 'row_count', v_row_count,
                             'created', v_created, 'skipped_existing', v_skipped));

  return jsonb_build_object('job_id', v_job, 'row_count', v_row_count,
                            'created', v_created, 'skipped', v_skipped, 'replayed', false);
exception when others then
  if v_job is not null then
    update public.bulk_import_jobs
    set status = 'failed', error_count = v_row_count, completed_at = now()
    where id = v_job;
  end if;
  raise;
end $$;

revoke all on function public.bulk_import_patients(jsonb,text,uuid) from public, anon;
grant execute on function public.bulk_import_patients(jsonb,text,uuid) to authenticated, service_role;

commit;
