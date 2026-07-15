/**
 * Calendar date range parsing utilities
 * 
 * Problem: new Date("YYYY-MM-DD") creates midnight UTC, which excludes
 * items on the end day when they have times later in the day (IST).
 * 
 * Solution: Parse YYYY-MM-DD strings as IST dates covering full local days.
 */

/**
 * Parse a YYYY-MM-DD string as the START of that day in IST (UTC+5:30)
 * Example: "2025-12-24" -> 2025-12-24T00:00:00+05:30 -> 2025-12-23T18:30:00Z
 */
export function parseStartOfDayIST(ymd: string): Date {
  // Create ISO string with IST offset at start of day
  return new Date(`${ymd}T00:00:00+05:30`);
}

/**
 * Parse a YYYY-MM-DD string as the END of that day in IST (UTC+5:30)
 * Example: "2025-12-24" -> 2025-12-24T23:59:59.999+05:30 -> 2025-12-24T18:29:59.999Z
 */
export function parseEndOfDayIST(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

/**
 * Parse calendar API query params (start/end as YYYY-MM-DD) to Date range
 * 
 * Contract: start and end are INCLUSIVE in IST timezone
 * 
 * @param start - YYYY-MM-DD string (inclusive)
 * @param end - YYYY-MM-DD string (inclusive, full day)
 * @returns [startDate, endDate] covering full IST days
 */
export function parseCalendarRange(start: string, end: string): [Date, Date] {
  const startDate = parseStartOfDayIST(start);
  const endDate = parseEndOfDayIST(end);
  
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error(`Invalid calendar range: start="${start}" end="${end}"`);
  }
  
  if (endDate < startDate) {
    throw new Error(`Invalid calendar range: end "${end}" is before start "${start}"`);
  }
  
  return [startDate, endDate];
}

/**
 * Convert a Date to IST YYYY-MM-DD string
 * Used by server to return dueDateLocalYmd field
 */
export function toISTDateString(date: Date): string {
  // Add IST offset (+5.5 hours in milliseconds)
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return istDate.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

