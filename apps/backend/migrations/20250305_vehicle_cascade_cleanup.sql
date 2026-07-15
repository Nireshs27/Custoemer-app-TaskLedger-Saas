-- Clean up orphaned reminder history rows before adding FK
DELETE FROM reminder_history rh
WHERE rh.reminder_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM reminder_schedules rs WHERE rs.id = rh.reminder_id
  );

-- Rebuild reminder_history -> reminder_schedules FK with ON DELETE CASCADE
ALTER TABLE reminder_history
  DROP CONSTRAINT IF EXISTS reminder_history_reminder_id_fkey;

ALTER TABLE reminder_history
  ADD CONSTRAINT reminder_history_reminder_id_fkey
  FOREIGN KEY (reminder_id)
  REFERENCES reminder_schedules(id)
  ON DELETE CASCADE;

-- Rebuild vehicle_items -> vehicles FK with ON DELETE CASCADE
ALTER TABLE vehicle_items
  DROP CONSTRAINT IF EXISTS vehicle_items_vehicle_id_fkey;

ALTER TABLE vehicle_items
  ADD CONSTRAINT vehicle_items_vehicle_id_fkey
  FOREIGN KEY (vehicle_id)
  REFERENCES vehicles(id)
  ON DELETE CASCADE;

