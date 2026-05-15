-- Speed up per-session depth gate lookups so fresh sessions do not replay old stage progress.

CREATE INDEX IF NOT EXISTS idx_study_depth_checks_entry_session
ON study_depth_checks(study_plan_entry_id, session_id, created_at DESC);
