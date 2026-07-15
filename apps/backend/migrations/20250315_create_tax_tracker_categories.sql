-- Create tax_tracker_categories table for centralized category management
CREATE TABLE IF NOT EXISTS tax_tracker_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT tax_tracker_categories_module_slug_unique UNIQUE (module, slug)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tax_tracker_categories_module ON tax_tracker_categories(module);
CREATE INDEX IF NOT EXISTS idx_tax_tracker_categories_is_active ON tax_tracker_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_tax_tracker_categories_sort_order ON tax_tracker_categories(sort_order);

-- Insert system categories for vehicle module
INSERT INTO tax_tracker_categories (module, name, slug, is_system, is_active, sort_order) VALUES
('vehicle', 'Insurance', 'insurance', true, true, 10),
('vehicle', 'Registration', 'registration', true, true, 20),
('vehicle', 'PUC', 'puc', true, true, 30),
('vehicle', 'Fitness Certificate', 'fitness_certificate', true, true, 40),
('vehicle', 'Permit', 'permit', true, true, 50),
('vehicle', 'Road Tax', 'road_tax', true, true, 60),
('vehicle', 'Service', 'service', true, true, 70),
('vehicle', 'Repair', 'repair', true, true, 80)
ON CONFLICT (module, slug) DO NOTHING;

-- Insert system categories for asset module
INSERT INTO tax_tracker_categories (module, name, slug, is_system, is_active, sort_order) VALUES
('asset', 'Service', 'service', true, true, 10),
('asset', 'Maintenance', 'maintenance', true, true, 20),
('asset', 'Warranty', 'warranty', true, true, 30),
('asset', 'AMC', 'amc', true, true, 40),
('asset', 'Insurance', 'insurance', true, true, 50),
('asset', 'Calibration', 'calibration', true, true, 60),
('asset', 'Inspection', 'inspection', true, true, 70),
('asset', 'Repair', 'repair', true, true, 80),
('asset', 'Upgrade', 'upgrade', true, true, 90)
ON CONFLICT (module, slug) DO NOTHING;

-- Insert system categories for task_action module
INSERT INTO tax_tracker_categories (module, name, slug, is_system, is_active, sort_order) VALUES
('task_action', 'Tax Review', 'tax_review', true, true, 10),
('task_action', 'Insurance', 'insurance', true, true, 20),
('task_action', 'Maintenance', 'maintenance', true, true, 30),
('task_action', 'Documentation', 'documentation', true, true, 40),
('task_action', 'Compliance', 'compliance', true, true, 50),
('task_action', 'Audit', 'audit', true, true, 60),
('task_action', 'Renewal', 'renewal', true, true, 70),
('task_action', 'Other', 'other', true, true, 80)
ON CONFLICT (module, slug) DO NOTHING;

-- Insert system categories for tax_legal module
INSERT INTO tax_tracker_categories (module, name, slug, is_system, is_active, sort_order) VALUES
('tax_legal', 'GST', 'gst', true, true, 10),
('tax_legal', 'Income Tax', 'income_tax', true, true, 20),
('tax_legal', 'Property Tax', 'property_tax', true, true, 30),
('tax_legal', 'Professional Tax', 'professional_tax', true, true, 40),
('tax_legal', 'TDS', 'tds', true, true, 50),
('tax_legal', 'Advance Payment', 'advance_payment', true, true, 60),
('tax_legal', 'Business License', 'business_license', true, true, 70),
('tax_legal', 'Trade License', 'trade_license', true, true, 80),
('tax_legal', 'Food License', 'food_license', true, true, 90),
('tax_legal', 'Fire Safety', 'fire_safety', true, true, 100),
('tax_legal', 'Pollution Clearance', 'pollution_clearance', true, true, 110),
('tax_legal', 'GST Registration', 'gst_registration', true, true, 120),
('tax_legal', 'Shop Establishment', 'shop_establishment', true, true, 130),
('tax_legal', 'Factory License', 'factory_license', true, true, 140)
ON CONFLICT (module, slug) DO NOTHING;

-- Insert system categories for reminder_tasks module (one-time and recurring tasks)
INSERT INTO tax_tracker_categories (module, name, slug, is_system, is_active, sort_order) VALUES
('reminder_tasks', 'General', 'general', true, true, 10),
('reminder_tasks', 'Meeting', 'meeting', true, true, 20),
('reminder_tasks', 'Follow-up', 'follow_up', true, true, 30),
('reminder_tasks', 'Review', 'review', true, true, 40),
('reminder_tasks', 'Payment', 'payment', true, true, 50),
('reminder_tasks', 'Documentation', 'documentation', true, true, 60),
('reminder_tasks', 'Other', 'other', true, true, 70)
ON CONFLICT (module, slug) DO NOTHING;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tax_tracker_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tax_tracker_categories_updated_at
BEFORE UPDATE ON tax_tracker_categories
FOR EACH ROW
EXECUTE FUNCTION update_tax_tracker_categories_updated_at();

