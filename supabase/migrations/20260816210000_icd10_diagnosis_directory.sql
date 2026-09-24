-- ICD-10 coded diagnoses for the consultation diagnosis box.
--
-- The directory already carries `code` / `code_system` and the search RPC
-- already matches on a code prefix, but nothing had ever been loaded into them:
-- every diagnosis in the database was an uncoded local phrase, so typing "J45"
-- or "asthma" found nothing standardised.
--
-- Two parts:
--   1. The bulk clinical import now carries code and code_system, so the
--      hospital can load a fuller ICD-10 file (or their own coded list)
--      through Admin -> Clinical Directory without a script.
--   2. A starter set of ICD-10 titles covering the presentations a general
--      hospital in Tamil Nadu actually sees, so the box is useful on day one.
--
-- Source: ICD-10, World Health Organization. Titles are the classification's
-- own; no proprietary dataset is redistributed here. SNOMED CT is deliberately
-- not used: it needs a member/affiliate licence, and ICD-10 is what Indian
-- hospital records and insurance claims are written against.
begin;

-- 1. Coded bulk import ---------------------------------------------------
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
          -- A blank code column in the sheet leaves an existing code alone
          -- rather than wiping the classification off the term.
          code = coalesce(nullif(trim(coalesce(v_row->>'code','')),''), code),
          code_system = coalesce(nullif(trim(coalesce(v_row->>'code_system','')),''), code_system),
          active = coalesce((v_row->>'active')::boolean, true),
          updated_at = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.clinical_terms(term_type, display_text, search_aliases, code, code_system, active, source)
      values (
        v_row->>'term_type',
        v_row->>'display_text',
        coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(v_row->'search_aliases') as value),
          '{}'
        ),
        nullif(trim(coalesce(v_row->>'code','')),''),
        nullif(trim(coalesce(v_row->>'code_system','')),''),
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

-- 2. Starter ICD-10 diagnoses -------------------------------------------
insert into public.clinical_terms (term_type, display_text, code, code_system, source, source_license, source_version, active)
select 'diagnosis', d.title, d.code, 'ICD-10', 'icd10', 'WHO ICD-10 classification', 'ICD-10 (WHO)', true
from (values
  ('A01.0','Typhoid fever'),
  ('A06.0','Acute amoebic dysentery'),
  ('A09','Infectious gastroenteritis and colitis, unspecified'),
  ('A15.0','Tuberculosis of lung, confirmed'),
  ('A16.9','Respiratory tuberculosis, unspecified'),
  ('A27.9','Leptospirosis, unspecified'),
  ('A75.3','Scrub typhus'),
  ('A90','Dengue fever'),
  ('A91','Dengue haemorrhagic fever'),
  ('B01.9','Chickenpox without complication'),
  ('B05.9','Measles without complication'),
  ('B15.9','Hepatitis A without hepatic coma'),
  ('B16.9','Acute hepatitis B without hepatic coma'),
  ('B19.9','Unspecified viral hepatitis without hepatic coma'),
  ('B24','Unspecified HIV disease'),
  ('B34.9','Viral infection, unspecified'),
  ('B35.9','Dermatophytosis, unspecified'),
  ('B37.9','Candidiasis, unspecified'),
  ('B50.9','Plasmodium falciparum malaria, unspecified'),
  ('B51.9','Plasmodium vivax malaria without complication'),
  ('B54','Unspecified malaria'),
  ('B77.9','Ascariasis, unspecified'),
  ('D50.9','Iron deficiency anaemia, unspecified'),
  ('D56.1','Beta thalassaemia'),
  ('D64.9','Anaemia, unspecified'),
  ('E03.9','Hypothyroidism, unspecified'),
  ('E05.9','Thyrotoxicosis, unspecified'),
  ('E10.9','Type 1 diabetes mellitus without complications'),
  ('E11.7','Type 2 diabetes mellitus with multiple complications'),
  ('E11.9','Type 2 diabetes mellitus without complications'),
  ('E14.9','Unspecified diabetes mellitus without complications'),
  ('E55.9','Vitamin D deficiency, unspecified'),
  ('E66.9','Obesity, unspecified'),
  ('E78.5','Hyperlipidaemia, unspecified'),
  ('E86','Volume depletion'),
  ('E87.6','Hypokalaemia'),
  ('F10.2','Alcohol dependence syndrome'),
  ('F32.9','Depressive episode, unspecified'),
  ('F41.1','Generalized anxiety disorder'),
  ('F41.9','Anxiety disorder, unspecified'),
  ('F51.0','Nonorganic insomnia'),
  ('G40.9','Epilepsy, unspecified'),
  ('G43.9','Migraine, unspecified'),
  ('G44.2','Tension-type headache'),
  ('G45.9','Transient cerebral ischaemic attack, unspecified'),
  ('G51.0','Bell palsy'),
  ('G62.9','Polyneuropathy, unspecified'),
  ('H10.9','Conjunctivitis, unspecified'),
  ('H25.9','Senile cataract, unspecified'),
  ('H40.9','Glaucoma, unspecified'),
  ('H52.4','Presbyopia'),
  ('H60.9','Otitis externa, unspecified'),
  ('H61.2','Impacted cerumen'),
  ('H66.9','Otitis media, unspecified'),
  ('H81.1','Benign paroxysmal vertigo'),
  ('H91.9','Hearing loss, unspecified'),
  ('I10','Essential (primary) hypertension'),
  ('I20.9','Angina pectoris, unspecified'),
  ('I21.9','Acute myocardial infarction, unspecified'),
  ('I25.9','Chronic ischaemic heart disease, unspecified'),
  ('I48','Atrial fibrillation and flutter'),
  ('I50.9','Heart failure, unspecified'),
  ('I63.9','Cerebral infarction, unspecified'),
  ('I64','Stroke, not specified as haemorrhage or infarction'),
  ('I83.9','Varicose veins of lower extremities without ulcer or inflammation'),
  ('I88.9','Nonspecific lymphadenitis, unspecified'),
  ('J00','Acute nasopharyngitis (common cold)'),
  ('J01.9','Acute sinusitis, unspecified'),
  ('J02.9','Acute pharyngitis, unspecified'),
  ('J03.9','Acute tonsillitis, unspecified'),
  ('J04.0','Acute laryngitis'),
  ('J06.9','Acute upper respiratory infection, unspecified'),
  ('J11.1','Influenza with other respiratory manifestations, virus not identified'),
  ('J18.9','Pneumonia, unspecified organism'),
  ('J20.9','Acute bronchitis, unspecified'),
  ('J30.4','Allergic rhinitis, unspecified'),
  ('J31.0','Chronic rhinitis'),
  ('J35.0','Chronic tonsillitis'),
  ('J40','Bronchitis, not specified as acute or chronic'),
  ('J42','Unspecified chronic bronchitis'),
  ('J44.9','Chronic obstructive pulmonary disease, unspecified'),
  ('J45.9','Asthma, unspecified'),
  ('J90','Pleural effusion'),
  ('K02.9','Dental caries, unspecified'),
  ('K21.9','Gastro-oesophageal reflux disease without oesophagitis'),
  ('K25.9','Gastric ulcer, unspecified'),
  ('K29.7','Gastritis, unspecified'),
  ('K30','Functional dyspepsia'),
  ('K35.8','Acute appendicitis, other and unspecified'),
  ('K40.9','Unilateral inguinal hernia without obstruction or gangrene'),
  ('K52.9','Noninfective gastroenteritis and colitis, unspecified'),
  ('K58.9','Irritable bowel syndrome without diarrhoea'),
  ('K59.0','Constipation'),
  ('K64.9','Haemorrhoids, unspecified'),
  ('K74.6','Other and unspecified cirrhosis of liver'),
  ('K76.0','Fatty liver, not elsewhere classified'),
  ('K80.2','Calculus of gallbladder without cholecystitis'),
  ('K81.9','Cholecystitis, unspecified'),
  ('K85.9','Acute pancreatitis, unspecified'),
  ('K92.2','Gastrointestinal haemorrhage, unspecified'),
  ('L01.0','Impetigo'),
  ('L02.9','Cutaneous abscess, furuncle and carbuncle, unspecified'),
  ('L03.9','Cellulitis, unspecified'),
  ('L20.9','Atopic dermatitis, unspecified'),
  ('L23.9','Allergic contact dermatitis, unspecified cause'),
  ('L29.9','Pruritus, unspecified'),
  ('L30.9','Dermatitis, unspecified'),
  ('L40.9','Psoriasis, unspecified'),
  ('L50.9','Urticaria, unspecified'),
  ('L70.0','Acne vulgaris'),
  ('L80','Vitiligo'),
  ('M06.9','Rheumatoid arthritis, unspecified'),
  ('M10.9','Gout, unspecified'),
  ('M13.9','Arthritis, unspecified'),
  ('M15.9','Polyarthrosis, unspecified'),
  ('M17.9','Gonarthrosis, unspecified'),
  ('M19.9','Arthrosis, unspecified'),
  ('M25.5','Pain in joint'),
  ('M47.9','Spondylosis, unspecified'),
  ('M51.1','Lumbar and other intervertebral disc disorders with radiculopathy'),
  ('M54.2','Cervicalgia'),
  ('M54.5','Low back pain'),
  ('M62.6','Muscle strain'),
  ('M75.1','Rotator cuff syndrome'),
  ('M79.1','Myalgia'),
  ('M81.9','Osteoporosis, unspecified'),
  ('N10','Acute tubulo-interstitial nephritis'),
  ('N18.9','Chronic kidney disease, unspecified'),
  ('N20.0','Calculus of kidney'),
  ('N20.1','Calculus of ureter'),
  ('N23','Unspecified renal colic'),
  ('N30.9','Cystitis, unspecified'),
  ('N39.0','Urinary tract infection, site not specified'),
  ('N40','Hyperplasia of prostate'),
  ('N76.0','Acute vaginitis'),
  ('N80.9','Endometriosis, unspecified'),
  ('N91.2','Amenorrhoea, unspecified'),
  ('N92.0','Excessive and frequent menstruation with regular cycle'),
  ('N93.9','Abnormal uterine and vaginal bleeding, unspecified'),
  ('N94.6','Dysmenorrhoea, unspecified'),
  ('N95.1','Menopausal and female climacteric states'),
  ('O14.9','Pre-eclampsia, unspecified'),
  ('O21.0','Mild hyperemesis gravidarum'),
  ('O24.4','Diabetes mellitus arising in pregnancy'),
  ('O80','Single spontaneous delivery'),
  ('P59.9','Neonatal jaundice, unspecified'),
  ('R05','Cough'),
  ('R06.0','Dyspnoea'),
  ('R07.4','Chest pain, unspecified'),
  ('R10.4','Other and unspecified abdominal pain'),
  ('R11','Nausea and vomiting'),
  ('R42','Dizziness and giddiness'),
  ('R50.9','Fever, unspecified'),
  ('R51','Headache'),
  ('R53','Malaise and fatigue'),
  ('R55','Syncope and collapse'),
  ('R60.0','Localized oedema'),
  ('R63.0','Anorexia'),
  ('R73.9','Hyperglycaemia, unspecified'),
  ('T14.1','Open wound of unspecified body region'),
  ('T30.0','Burn of unspecified body region, unspecified degree'),
  ('T63.0','Toxic effect of snake venom'),
  ('T78.2','Anaphylactic shock, unspecified'),
  ('T78.4','Allergy, unspecified'),
  ('U07.1','COVID-19, virus identified'),
  ('W54','Bitten or struck by dog'),
  ('Z00.0','General medical examination'),
  ('Z23','Encounter for immunization'),
  ('Z34.9','Supervision of normal pregnancy, unspecified')
) as d(code, title)
on conflict (term_type, normalized_text) do update
  set code = excluded.code,
      code_system = excluded.code_system,
      source = excluded.source,
      source_version = excluded.source_version,
      updated_at = now();

commit;
