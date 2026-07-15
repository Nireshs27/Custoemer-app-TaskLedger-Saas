-- Create calendar_events table for quick events (meetings, appointments, etc.)
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_time TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  
  -- Simple reminder system
  reminder_days INTEGER DEFAULT 1,
  reminder_times JSONB DEFAULT '["09:00"]'::jsonb,
  
  -- Notification preferences
  notification_channels JSONB DEFAULT '["email"]'::jsonb,
  email_recipients JSONB DEFAULT '[]'::jsonb,
  whatsapp_recipients JSONB DEFAULT '[]'::jsonb,
  sms_recipients JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  created_by UUID NOT NULL REFERENCES taskledger_users(id),
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Create index on event_date for faster queries
CREATE INDEX IF NOT EXISTS idx_calendar_events_event_date ON calendar_events(event_date);

-- Create index on created_by for user-specific queries
CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON calendar_events(created_by);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status);

