ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs
ADD CONSTRAINT jobs_type_check
CHECK (type IN (
  'plan',
  'chat',
  'grade',
  'transcribe',
  'metadata',
  'embed',
  'practice_exam',
  'lecture_pdf_reindex',
  'lecture_plan_v2',
  'lecture_plan_inventory',
  'lecture_plan_synthesize',
  'question_generation',
  'readiness_roadmap',
  'cheat_sheet'
));
