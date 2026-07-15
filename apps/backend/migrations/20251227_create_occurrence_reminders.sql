-- Migration: Create occurrence_reminders table for one-time task reminders
-- Purpose: Migrate one-time tasks from reminder_schedules to occurrence_reminders
-- Date: 2024-12-27

-- Create occurrence_reminders table
CREATE TABLE IF NOT EXISTS occurrence_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES taskledger_users(id) ON DELETE CASCADE,
  
  -- Task context
  entity_type TEXT NOT NULL, -- 'vehicle_item', 'asset_item', 'task_action_item', 'tax_item', 'tax_legal_item'
  entity_id UUID NOT NULL,
  
  -- Occurrence identification
  occurrence_task_utc TIMESTAMP NOT NULL, -- When the task is actually due
  occurrence_key TEXT NOT NULL, -- Unique key: "entityType:entityId::occurrenceTaskUtc"
  
  -- Task status tracking (synced from base task)
  task_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'cancelled'
  completed_at TIMESTAMP,
  task_note TEXT, -- Completion note
  due_date_local_ymd TEXT NOT NULL, -- IST date string YYYY-MM-DD
  
  -- Reminder scheduling
  reminder_at_utc TIMESTAMP NOT NULL, -- When to send this reminder
  channel TEXT NOT NULL, -- 'email' | 'whatsapp'
  recipient TEXT NOT NULL, -- email address or phone number
  
  -- Delivery status
  reminder_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  last_error TEXT,
  message_id TEXT, -- Email message ID if sent
  
  -- Task metadata (denormalized for query performance)
  task_title TEXT NOT NULL,
  task_category TEXT,
  
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_user_id 
  ON occurrence_reminders(user_id);

CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_entity 
  ON occurrence_reminders(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_occurrence_key 
  ON occurrence_reminders(occurrence_key);

CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_pending 
  ON occurrence_reminders(reminder_status, reminder_at_utc) 
  WHERE reminder_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_task_status 
  ON occurrence_reminders(task_status);

-- Create unique constraint to prevent duplicate reminders
-- This ensures idempotency when creating occurrence reminders
CREATE UNIQUE INDEX IF NOT EXISTS occurrence_reminders_uq_instance 
  ON occurrence_reminders(user_id, occurrence_key, reminder_at_utc, channel, recipient);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_occurrence_reminders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_occurrence_reminders_updated_at ON occurrence_reminders;
CREATE TRIGGER update_occurrence_reminders_updated_at
  BEFORE UPDATE ON occurrence_reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_occurrence_reminders_updated_at();

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ occurrence_reminders table created successfully!';
  RAISE NOTICE '   - Table supports one-time task reminders';
  RAISE NOTICE '   - Unique constraint prevents duplicate reminders';
  RAISE NOTICE '   - Indexes created for query performance';
  RAISE NOTICE '   - Legacy reminder_schedules table remains for recurring tasks';
END $$;

