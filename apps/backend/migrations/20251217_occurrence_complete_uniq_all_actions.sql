-- Ensure exactly one row per user + occurrence + action for idempotent writes
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS task_occurrence_events_user_occurrence_action_uniq
ON public.task_occurrence_events (user_id, occurrence_key, action);

