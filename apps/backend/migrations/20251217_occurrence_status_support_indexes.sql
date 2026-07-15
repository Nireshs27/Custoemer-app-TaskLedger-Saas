-- Supporting indexes for fast, reliable occurrence status lookups
-- A) Latest row per occurrence_key (ordered by created_at)
CREATE INDEX IF NOT EXISTS task_occ_events_user_key_created_desc_idx
ON public.task_occurrence_events (user_id, occurrence_key, created_at DESC)
INCLUDE (status, note, occurrence_task_utc);

-- B) Time-range scans by user + occurrence_task_utc
CREATE INDEX IF NOT EXISTS task_occ_events_user_time_idx
ON public.task_occurrence_events (user_id, occurrence_task_utc)
INCLUDE (occurrence_key, created_at, status, note);

-- C) Prefix LIKE support on occurrence_key
CREATE INDEX IF NOT EXISTS task_occ_events_user_key_like_idx
ON public.task_occurrence_events (user_id, occurrence_key text_pattern_ops);

