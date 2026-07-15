-- Add 'reminder_tasks' to the tax_tracker_category_module enum if it exists
-- This migration handles the case where the module column is an enum type

DO $$ 
BEGIN
  -- Check if the enum type exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tax_tracker_category_module') THEN
    -- Check if 'reminder_tasks' is not already in the enum
    IF NOT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumtypid = 'tax_tracker_category_module'::regtype 
      AND enumlabel = 'reminder_tasks'
    ) THEN
      -- Add 'reminder_tasks' to the enum
      ALTER TYPE tax_tracker_category_module ADD VALUE 'reminder_tasks';
      RAISE NOTICE 'Added reminder_tasks to tax_tracker_category_module enum';
    ELSE
      RAISE NOTICE 'reminder_tasks already exists in tax_tracker_category_module enum';
    END IF;
  ELSE
    -- If enum doesn't exist, the column is already TEXT, no action needed
    RAISE NOTICE 'tax_tracker_category_module enum does not exist - column is TEXT';
  END IF;
END $$;

