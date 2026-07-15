/**
 * Task Filter Utilities (Minimal & Simple)
 * Shared helpers for /api/tasks and /api/tasks/counts
 */

/**
 * Get today's date in YYYY-MM-DD format (IST timezone)
 */
export function getTodayYmdIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const day = String(ist.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse and validate YYYY-MM month string
 * Returns null if invalid
 */
export function parseMonthParam(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  
  // Strict YYYY-MM format check
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return null;
  
  // Validate it's a real month
  const [year, month] = trimmed.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  
  return trimmed;
}

/**
 * Convert YYYY-MM month to date range
 * Returns { fromYmd: 'YYYY-MM-01', toYmdExclusive: 'YYYY-MM-01' of next month }
 */
export function monthToRange(month: string): { fromYmd: string; toYmdExclusive: string } {
  const [year, monthNum] = month.split('-').map(Number);
  const fromYmd = `${month}-01`;
  
  // Calculate next month (handle Dec -> Jan rollover)
  let nextYear = year;
  let nextMonth = monthNum + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  
  const toYmdExclusive = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  
  return { fromYmd, toYmdExclusive };
}

/**
 * Map UI kind to DB entity_type values
 */
export function kindToEntityTypes(kind: string): string[] {
  const map: Record<string, string[]> = {
    all: [],
    vehicle: ['vehicle_item'],
    asset: ['asset_item'],
    action: ['task_action', 'task_action_item'],
    taxlegal: ['tax_item', 'tax_legal_item'],
  };
  return map[kind] ?? [];
}

/**
 * Map DB entity_type to UI entityType
 */
export function mapDbEntityToUi(entityType: string): 'taxlegal' | 'vehicle' | 'asset' | 'action' {
  if (entityType === 'vehicle_item') return 'vehicle';
  if (entityType === 'asset_item') return 'asset';
  if (entityType === 'task_action' || entityType === 'task_action_item') return 'action';
  if (entityType === 'tax_item' || entityType === 'tax_legal_item') return 'taxlegal';
  return 'taxlegal'; // fallback
}

