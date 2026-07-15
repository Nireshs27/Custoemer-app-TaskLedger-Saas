-- Additional supporting indexes for occurrence status lookups under load.
-- A) Latest row per occurrence_key with stable tie-break on id
CREATE INDEX IF NOT EXISTS task_occ_events_user_key_created_id_desc_idx
ON public.task_occurrence_events (user_id, occurrence_key, created_at DESC, id DESC)
INCLUDE (status, note, occurrence_task_utc);

-- B) Time-range scans by user + occurrence_task_utc (includes id for tie-break)
CREATE INDEX IF NOT EXISTS task_occ_events_user_occurrence_time_idx
ON public.task_occurrence_events (user_id, occurrence_task_utc)
INCLUDE (occurrence_key, created_at, id, status, note);

-- C) Prefix LIKE support on occurrence_key (keeps existing name; IF NOT EXISTS is safe)
CREATE INDEX IF NOT EXISTS task_occ_events_user_key_like_idx
ON public.task_occurrence_events (user_id, occurrence_key text_pattern_ops);

