-- Add core asset metadata columns (parity with UI fields)
alter table if exists public.assets
  add column if not exists bought_under text,
  add column if not exists depreciation_percent numeric(10,2),
  add column if not exists depreciation_method text;

-- Ensure asset_items has reminder offset columns (safety for older environments)
alter table if exists public.asset_items
  add column if not exists reminder_offset_value integer default 7,
  add column if not exists reminder_offset_unit text default 'days';

-- Helpful indexes for asset_items
create index if not exists asset_items_created_by_idx on public.asset_items(created_by);
create index if not exists asset_items_asset_due_date_idx on public.asset_items(asset_id, due_date);

