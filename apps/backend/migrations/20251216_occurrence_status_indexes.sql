-- Indexes to speed up and stabilize occurrence status lookups
create index if not exists idx_toe_user_occ_created
  on task_occurrence_events (user_id, occurrence_key, created_at desc, id desc);

create index if not exists idx_toe_user_taskutc
  on task_occurrence_events (user_id, occurrence_task_utc);

