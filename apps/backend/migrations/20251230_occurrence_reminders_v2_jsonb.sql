-- Migration: Update occurrence_reminders to 1-row-per-occurrence with JSONB recipient_status
-- Purpose: Consolidate per-recipient rows into a single row per (occurrence, channel)
-- Date: 2024-12-30

-- Drop old unique constraint
DROP INDEX IF EXISTS occurrence_reminders_uq_instance;

-- Remove old columns
ALTER TABLE occurrence_reminders 
  DROP COLUMN IF EXISTS channel,
  DROP COLUMN IF EXISTS recipient,
  DROP COLUMN IF EXISTS reminder_status,
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS last_attempt_at,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS message_id;

-- Add new columns
ALTER TABLE occurrence_reminders
  ADD COLUMN IF NOT EXISTS reminder_channel TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS recipient_status JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Add constraint: reminder_channel must be 'email' or 'whatsapp'
ALTER TABLE occurrence_reminders
  DROP CONSTRAINT IF EXISTS check_reminder_channel,
  ADD CONSTRAINT check_reminder_channel 
    CHECK (reminder_channel IN ('email', 'whatsapp'));

-- Create validation function for recipient_status
CREATE OR REPLACE FUNCTION validate_occurrence_recipients()
RETURNS TRIGGER AS $$
DECLARE
  recipient_key TEXT;
  recipient_value JSONB;
BEGIN
  -- recipient_status must be a non-empty object
  IF jsonb_typeof(NEW.recipient_status) != 'object' OR NEW.recipient_status = '{}'::jsonb THEN
    RAISE EXCEPTION 'recipient_status must be a non-empty object';
  END IF;

  -- Validate each recipient entry
  FOR recipient_key, recipient_value IN SELECT * FROM jsonb_each(NEW.recipient_status)
  LOOP
    -- Email validation (basic pattern)
    IF NEW.reminder_channel = 'email' THEN
      IF recipient_key !~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email recipient key: %', recipient_key;
      END IF;
    END IF;

    -- WhatsApp validation (phone-like pattern)
    IF NEW.reminder_channel = 'whatsapp' THEN
      IF recipient_key !~ '^[+]?[0-9]{10,15}$' THEN
        RAISE EXCEPTION 'Invalid phone recipient key: %', recipient_key;
      END IF;
    END IF;

    -- Validate recipient value has required fields
    IF NOT (recipient_value ? 'status' AND recipient_value ? 'attempts') THEN
      RAISE EXCEPTION 'Recipient % missing required fields (status, attempts)', recipient_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for recipient validation
DROP TRIGGER IF EXISTS validate_occurrence_recipients_trigger ON occurrence_reminders;
CREATE TRIGGER validate_occurrence_recipients_trigger
  BEFORE INSERT OR UPDATE ON occurrence_reminders
  FOR EACH ROW
  EXECUTE FUNCTION validate_occurrence_recipients();

-- Create new unique constraint: one row per (user, occurrence, channel)
CREATE UNIQUE INDEX occurrence_reminders_uq_instance
  ON occurrence_reminders(user_id, occurrence_key, reminder_channel);

-- Drop old indexes that reference removed columns
DROP INDEX IF EXISTS idx_occurrence_reminders_pending;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_reminder_at_utc
  ON occurrence_reminders(reminder_at_utc)
  WHERE task_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_occurrence_reminders_channel
  ON occurrence_reminders(reminder_channel);

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ occurrence_reminders table migrated to v2 (JSONB recipient_status)';
  RAISE NOTICE '   - Schema: 1 row per (occurrence, channel) with all recipients in JSON';
  RAISE NOTICE '   - Validation trigger enforces non-empty recipient_status';
  RAISE NOTICE '   - Unique constraint: (user_id, occurrence_key, reminder_channel)';
END $$;

