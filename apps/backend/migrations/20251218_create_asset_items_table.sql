-- Create asset_items table mirroring vehicle_items (tasks for assets)
-- Includes recurrence/reminder fields and multi-channel recipients
create table if not exists public.asset_items (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  title text not null,
  description text,
  category text not null,
  sub_category text,
  due_date date not null,
  amount numeric(15,2),
  status text not null default 'pending',

  -- Recurrence
  is_recurring boolean default false,
  recurrence_pattern text,
  recurrence_interval integer default 1,
  recurrence_end_date date,
  next_due_date date,
  recurrence_data jsonb,

  -- Reminders
  reminder_days integer default 7,
  reminder_offset_value integer default 7,
  reminder_offset_unit text not null default 'days',
  custom_reminder_dates jsonb default '[]'::jsonb,
  reminder_times jsonb default '["09:00"]'::jsonb,

  -- Notification channels
  notification_channels jsonb default '["email"]'::jsonb,
  email_recipients jsonb default '[]'::jsonb,
  whatsapp_recipients jsonb default '[]'::jsonb,
  sms_recipients jsonb default '[]'::jsonb,

  notes text,
  custom_fields jsonb default '{}'::jsonb,
  created_by uuid not null references public.app_users(id),
  completed_at timestamp,
  completion_notes text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

-- Helpful indexes
create index if not exists asset_items_asset_id_idx on public.asset_items(asset_id);
create index if not exists asset_items_created_by_idx on public.asset_items(created_by);
create index if not exists asset_items_asset_id_due_date_idx on public.asset_items(asset_id, due_date);



