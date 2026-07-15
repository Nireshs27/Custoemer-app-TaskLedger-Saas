-- Ensure idempotent completion writes: only one 'complete' per user+occurrence
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_occ_complete_once
ON task_occurrence_events (user_id, occurrence_key)
WHERE action = 'complete';

