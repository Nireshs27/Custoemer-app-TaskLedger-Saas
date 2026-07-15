-- Create task_action_items table (modeled after vehicle_items / asset_items)
CREATE TABLE IF NOT EXISTS task_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_action_id uuid NOT NULL REFERENCES task_actions(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text DEFAULT '',
  category text NOT NULL,
  sub_category text NULL,
  due_date date NOT NULL,
  due_time text NULL,
  status text NOT NULL DEFAULT 'pending',
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence_pattern text NULL,
  recurrence_interval integer DEFAULT 1,
  recurrence_end_date date NULL,
  next_due_date date NULL,
  recurrence_data jsonb NULL,
  reminder_days integer DEFAULT 7,
  reminder_offset_value integer DEFAULT 7,
  reminder_offset_unit text NOT NULL DEFAULT 'days',
  custom_reminder_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  reminder_times jsonb NOT NULL DEFAULT '["09:00"]'::jsonb,
  notification_channels jsonb NOT NULL DEFAULT '["email"]'::jsonb,
  email_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  whatsapp_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  sms_recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_action_items_task_action_id ON task_action_items(task_action_id);
CREATE INDEX IF NOT EXISTS idx_task_action_items_created_by ON task_action_items(created_by);
CREATE INDEX IF NOT EXISTS idx_task_action_items_due_date ON task_action_items(due_date);

