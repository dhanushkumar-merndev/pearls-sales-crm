-- The investigation box is now a dropdown, but the directory only held ten
-- entries, so the doctor was still typing nearly every test by hand. This loads
-- the investigations a general hospital actually orders -- lab work, imaging
-- and the common procedures -- so the list is useful from the first day.
--
-- Names are ordinary clinical English, not a licensed vocabulary. Staff can add
-- to this from Admin -> Clinical Directory, and anything a doctor types during
-- a consultation is saved back here automatically.
begin;

insert into public.clinical_terms (term_type, display_text, source, source_version, active)
select 'investigation', t.name, 'hospital', 'starter-investigations', true
from (values
  -- Blood and general laboratory
  ('Complete Blood Count (CBC)'),
  ('Haemoglobin (Hb)'),
  ('Peripheral smear'),
  ('ESR'),
  ('CRP'),
  ('Blood grouping and Rh typing'),
  ('Blood sugar - fasting'),
  ('Blood sugar - post prandial'),
  ('Random blood sugar'),
  ('HbA1c'),
  ('Lipid profile'),
  ('Liver function test (LFT)'),
  ('Renal function test (RFT)'),
  ('Serum creatinine'),
  ('Blood urea'),
  ('Serum electrolytes'),
  ('Serum calcium'),
  ('Serum uric acid'),
  ('Serum amylase'),
  ('Serum lipase'),
  ('Thyroid profile (T3, T4, TSH)'),
  ('Vitamin B12'),
  ('Vitamin D (25-OH)'),
  ('Serum ferritin'),
  ('Prothrombin time / INR'),
  ('APTT'),
  ('D-dimer'),
  ('Troponin I'),
  ('CK-MB'),
  ('NT-proBNP'),
  -- Infection and serology
  ('Dengue NS1 antigen'),
  ('Dengue IgM / IgG'),
  ('Widal test'),
  ('Malaria rapid test'),
  ('Scrub typhus IgM'),
  ('Leptospira IgM'),
  ('HIV screening'),
  ('HBsAg'),
  ('Anti-HCV'),
  ('VDRL'),
  ('Blood culture and sensitivity'),
  ('Sputum for AFB'),
  ('Sputum culture and sensitivity'),
  ('Throat swab culture'),
  ('COVID-19 RT-PCR'),
  -- Urine, stool and other samples
  ('Urine routine and microscopy'),
  ('Urine culture and sensitivity'),
  ('Urine pregnancy test'),
  ('Stool routine and microscopy'),
  ('Stool occult blood'),
  ('Semen analysis'),
  ('Pap smear'),
  ('FNAC'),
  ('Biopsy - histopathology'),
  -- Cardiac and pulmonary
  ('ECG'),
  ('Echocardiogram'),
  ('Treadmill test (TMT)'),
  ('Pulmonary function test (spirometry)'),
  -- Radiology
  ('X-Ray chest PA view'),
  ('X-Ray abdomen erect'),
  ('X-Ray KUB'),
  ('X-Ray cervical spine'),
  ('X-Ray lumbosacral spine'),
  ('X-Ray of limb'),
  ('Mammography'),
  ('DEXA bone density scan'),
  -- Ultrasound
  ('USG abdomen and pelvis'),
  ('USG KUB'),
  ('USG obstetric'),
  ('USG neck / thyroid'),
  ('USG breast'),
  ('USG scrotum'),
  ('Doppler study - lower limb'),
  ('Carotid doppler'),
  -- Cross-sectional imaging
  ('CT brain - plain'),
  ('CT brain - contrast'),
  ('CT chest'),
  ('HRCT chest'),
  ('CT abdomen and pelvis'),
  ('CT KUB'),
  ('MRI brain'),
  ('MRI spine'),
  ('MRI knee'),
  -- Procedures and neurophysiology
  ('Upper GI endoscopy'),
  ('Colonoscopy'),
  ('EEG'),
  ('Nerve conduction study'),
  ('Audiometry')
) as t(name)
on conflict (term_type, normalized_text) do nothing;

commit;
