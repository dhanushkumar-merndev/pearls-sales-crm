-- Bulk clinical directory import (AGENTS.md 21). The hospital's own vocabulary
-- -- local diagnosis wording, the investigations they actually order, standard
-- advice lines -- arrives as a spreadsheet rather than being typed term by term
-- through the admin dialog.
--
-- Existing terms are UPDATED rather than skipped: unlike a patient record, a
-- directory entry carries no history, and the usual reason to re-upload is to
-- correct wording or add aliases. Uniqueness is (term_type, normalized text),
-- so the same word may exist as both a symptom and a diagnosis.
begin;

create or replace function public.bulk_import_clinical_terms(
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
  v_updated integer := 0;
  v_existing uuid;
begin
  v_role := public.current_app_role();
  if v_role is null or v_role <> 'admin' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  v_row_count := jsonb_array_length(p_rows);
  if v_row_count < 1 or v_row_count > 1000 then
    raise exception 'row count must be between 1 and 1000';
  end if;

  select id into v_job from public.bulk_import_jobs where idempotency_key = p_idempotency_key;
  if v_job is not null then
    return (
      select jsonb_build_object('job_id', id, 'row_count', row_count,
                                'created', success_count, 'updated', error_count, 'replayed', true)
      from public.bulk_import_jobs where id = v_job
    );
  end if;

  insert into public.bulk_import_jobs(file_name, row_count, status, idempotency_key)
  values (left(p_file_name, 255), v_row_count, 'processing', p_idempotency_key)
  returning id into v_job;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    select id into v_existing
    from public.clinical_terms
    where term_type = v_row->>'term_type'
      and normalized_text = lower(regexp_replace(trim(v_row->>'display_text'), '\s+', ' ', 'g'));

    if v_existing is not null then
      update public.clinical_terms
      set display_text = v_row->>'display_text',
          search_aliases = coalesce(
            (select array_agg(value::text) from jsonb_array_elements_text(v_row->'search_aliases') as value),
            '{}'
          ),
          active = coalesce((v_row->>'active')::boolean, true),
          updated_at = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.clinical_terms(term_type, display_text, search_aliases, active, source)
      values (
        v_row->>'term_type',
        v_row->>'display_text',
        coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(v_row->'search_aliases') as value),
          '{}'
        ),
        coalesce((v_row->>'active')::boolean, true),
        'bulk import'
      );
      v_created := v_created + 1;
    end if;
  end loop;

  update public.bulk_import_jobs
  set success_count = v_created, error_count = v_updated, status = 'ready', completed_at = now()
  where id = v_job;

  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'BULK_CLINICAL_IMPORT_COMPLETED', 'bulk_import_job', v_job,
          jsonb_build_object('file_name', p_file_name, 'row_count', v_row_count,
                             'created', v_created, 'updated', v_updated));

  return jsonb_build_object('job_id', v_job, 'row_count', v_row_count,
                            'created', v_created, 'updated', v_updated, 'replayed', false);
exception when others then
  if v_job is not null then
    update public.bulk_import_jobs
    set status = 'failed', error_count = v_row_count, completed_at = now()
    where id = v_job;
  end if;
  raise;
end $$;

revoke all on function public.bulk_import_clinical_terms(jsonb,text,uuid) from public, anon;
grant execute on function public.bulk_import_clinical_terms(jsonb,text,uuid) to authenticated, service_role;

commit;
