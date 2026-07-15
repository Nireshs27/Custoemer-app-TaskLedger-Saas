ALTER TABLE vehicle_items
  ADD COLUMN IF NOT EXISTS reminder_offset_value INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reminder_offset_unit TEXT NOT NULL DEFAULT 'days';

ALTER TABLE reminder_schedules
  ADD COLUMN IF NOT EXISTS reminder_offset_value INTEGER DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reminder_offset_unit TEXT NOT NULL DEFAULT 'days';

