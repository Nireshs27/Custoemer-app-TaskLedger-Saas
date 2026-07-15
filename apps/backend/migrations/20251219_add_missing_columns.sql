-- Add missing columns used by the application; safe to run multiple times

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT '';

ALTER TABLE task_actions
  ADD COLUMN IF NOT EXISTS assignees jsonb NOT NULL DEFAULT '[]'::jsonb;

