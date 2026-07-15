-- Migration: Create Calendar Events table for simple event tracking
-- Purpose: Add quick event functionality for meetings, appointments, etc.

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  event_time TIME,
  status TEXT NOT NULL DEFAULT 'upcoming', -- 'upcoming', 'completed', 'cancelled'
  
  -- Reminder system (following vehicle_items pattern)
  reminder_days INTEGER DEFAULT 1,
  reminder_times JSONB DEFAULT '["09:00"]'::jsonb, -- Array of times to send reminders
  
  -- Multi-channel notification preferences
  notification_channels JSONB DEFAULT '["email"]'::jsonb, -- ['email', 'whatsapp', 'sms']
  email_recipients JSONB DEFAULT '[]'::jsonb, -- Array of email addresses
  whatsapp_recipients JSONB DEFAULT '[]'::jsonb, -- Array of WhatsApp numbers
  sms_recipients JSONB DEFAULT '[]'::jsonb, -- Array of SMS numbers
  
  notes TEXT,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_calendar_events_created_by ON calendar_events(created_by);
CREATE INDEX idx_calendar_events_event_date ON calendar_events(event_date);
CREATE INDEX idx_calendar_events_status ON calendar_events(status);
CREATE INDEX idx_calendar_events_upcoming ON calendar_events(status, event_date) 
  WHERE status = 'upcoming';

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_calendar_events_updated_at ON calendar_events;
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Success message
DO $$
BEGIN
  RAISE NOTICE '✅ Calendar events table created successfully!';
END $$;

