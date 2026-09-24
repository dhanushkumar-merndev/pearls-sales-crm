-- Coded diagnosis selection for the consultation screen.
--
-- ICD-10 is published by the WHO and freely usable, so a starter set of common
-- primary-care codes ships here. SNOMED-CT is deliberately NOT bundled: it needs
-- an affiliate licence (India has a national licence via its NRC, but it is not
-- ours to redistribute). The `code_system` column lets SNOMED terms be imported
-- later without any schema change.
begin;

alter table public.clinical_terms add column if not exists code text;
alter table public.clinical_terms add column if not exists code_system text;

create index if not exists clinical_terms_code_idx
  on public.clinical_terms(lower(code) text_pattern_ops) where active and code is not null;

-- Search by display text, alias, or code. Returns a bounded result set so the
-- browser never receives the whole directory (AGENTS.md 20).
create or replace function public.search_clinical_terms(
  p_term_type text,
  p_query text default null,
  p_limit integer default 20
)
returns table(id uuid, term_type text, display_text text, code text, code_system text)
language plpgsql stable security definer set search_path='' as $$
declare v_query text;
begin
  if public.current_app_role() not in ('admin','doctor','op','ip') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  v_query := nullif(trim(lower(coalesce(p_query,''))),'');
  return query
  select t.id, t.term_type, t.display_text, t.code, t.code_system
  from public.clinical_terms t
  where t.active
    and t.term_type = p_term_type
    and (
      v_query is null
      or t.normalized_text like v_query||'%'
      or t.normalized_text like '% '||v_query||'%'
      or lower(coalesce(t.code,'')) like v_query||'%'
      or exists (select 1 from unnest(t.search_aliases) a where lower(a) like v_query||'%')
    )
  order by
    case when t.normalized_text like v_query||'%' then 0 else 1 end,
    t.display_text
  limit least(greatest(p_limit,1),25);
end $$;

revoke all on function public.search_clinical_terms(text,text,integer) from public;
grant execute on function public.search_clinical_terms(text,text,integer) to authenticated;

-- Common primary-care ICD-10 diagnoses.
insert into public.clinical_terms(term_type, display_text, code, code_system, search_aliases, source, source_license)
values
  ('diagnosis','Cholera','A00','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Typhoid fever','A01.0','ICD-10',array['enteric fever'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Bacterial intestinal infection','A04.9','ICD-10',array['gastroenteritis'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Amoebiasis','A06.9','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Pulmonary tuberculosis','A15.0','ICD-10',array['TB','koch'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Dengue fever','A90','ICD-10',array['break bone fever'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Chikungunya virus disease','A92.0','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Varicella (chickenpox)','B01.9','ICD-10',array['chicken pox'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Viral infection, unspecified','B34.9','ICD-10',array['viral fever','viral illness'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Falciparum malaria','B50.9','ICD-10',array['malaria'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Iron deficiency anaemia','D50.9','ICD-10',array['anemia','anaemia'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Type 1 diabetes mellitus','E10.9','ICD-10',array['T1DM'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Type 2 diabetes mellitus','E11.9','ICD-10',array['T2DM','diabetes','sugar'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Hypothyroidism','E03.9','ICD-10',array['thyroid'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Hyperthyroidism','E05.9','ICD-10',array['thyrotoxicosis'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Obesity','E66.9','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Vitamin D deficiency','E55.9','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Depressive episode','F32.9','ICD-10',array['depression'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Anxiety disorder','F41.9','ICD-10',array['anxiety'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Migraine','G43.9','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Epilepsy','G40.9','ICD-10',array['seizure','fits'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Conjunctivitis','H10.9','ICD-10',array['red eye','madras eye'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Otitis media','H66.9','ICD-10',array['ear infection'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Essential (primary) hypertension','I10','ICD-10',array['HTN','high BP','blood pressure'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Angina pectoris','I20.9','ICD-10',array['chest pain cardiac'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute myocardial infarction','I21.9','ICD-10',array['heart attack','MI'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Heart failure','I50.9','ICD-10',array['CCF','CHF'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Stroke, not specified','I64','ICD-10',array['CVA'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute nasopharyngitis (common cold)','J00','ICD-10',array['cold','coryza'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute pharyngitis','J02.9','ICD-10',array['sore throat'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute tonsillitis','J03.9','ICD-10',array['tonsils'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute upper respiratory infection','J06.9','ICD-10',array['URTI','URI'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Influenza','J11.1','ICD-10',array['flu'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Pneumonia, unspecified','J18.9','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute bronchitis','J20.9','ICD-10',array['bronchitis'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Chronic obstructive pulmonary disease','J44.9','ICD-10',array['COPD'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Asthma','J45.9','ICD-10',array['bronchial asthma','wheeze'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Dental caries','K02.9','ICD-10',array['tooth decay'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Gastro-oesophageal reflux disease','K21.9','ICD-10',array['GERD','acidity','reflux'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Gastritis','K29.7','ICD-10',array['acute gastritis'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Peptic ulcer','K27.9','ICD-10',array['ulcer'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Acute appendicitis','K35.8','ICD-10',array['appendix'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Inguinal hernia','K40.9','ICD-10',array['hernia'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Haemorrhoids','K64.9','ICD-10',array['piles'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Cellulitis','L03.90','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Atopic dermatitis','L20.9','ICD-10',array['eczema'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Urticaria','L50.9','ICD-10',array['hives','allergy rash'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Scabies','B86','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Rheumatoid arthritis','M06.9','ICD-10',array['RA'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Osteoarthritis','M19.90','ICD-10',array['OA','joint pain'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Low back pain','M54.5','ICD-10',array['lumbago','lumbar sprain','back pain'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Cervical spondylosis','M47.812','ICD-10',array['neck pain'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Urinary tract infection','N39.0','ICD-10',array['UTI','burning micturition'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Calculus of kidney','N20.0','ICD-10',array['kidney stone','renal calculus'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Chronic kidney disease','N18.9','ICD-10',array['CKD'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Fever, unspecified','R50.9','ICD-10',array['fever','pyrexia'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Headache','R51','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Cough','R05','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Nausea and vomiting','R11','ICD-10',array['vomiting'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Diarrhoea','R19.7','ICD-10',array['loose stools','diarrhea'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Abdominal pain','R10.9','ICD-10',array['stomach pain'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Dizziness and giddiness','R42','ICD-10',array['vertigo','giddiness'],'WHO ICD-10','WHO ICD-10 public'),
  ('diagnosis','Anaemia, unspecified','D64.9','ICD-10',array[]::text[],'WHO ICD-10','WHO ICD-10 public')
on conflict (term_type, normalized_text) do update
  set code = excluded.code,
      code_system = excluded.code_system,
      search_aliases = excluded.search_aliases;

commit;
