/**
 * Pure timezone-proof status classification helpers
 * Uses IST (UTC+5:30) day strings for consistent behavior across timezones
 */

export type YmdStatus = "overdue" | "today" | "upcoming";

/**
 * Convert a Date to IST YYYY-MM-DD string
 * IST = UTC +05:30 (India Standard Time)
 */
export const toISTYmd = (d: Date): string => {
  // IST = UTC +05:30 (330 minutes)
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
};

/**
 * Pure function: classify status based on YMD string comparison
 * Deterministic, no Date object manipulation, timezone-independent
 * 
 * @param dueYmd - Due date as "YYYY-MM-DD" string
 * @param todayYmd - Today's date as "YYYY-MM-DD" string
 * @returns Status classification
 */
export const classifyYmdStatus = (dueYmd: string, todayYmd: string): YmdStatus => {
  if (!dueYmd || !todayYmd) return "upcoming";
  if (dueYmd < todayYmd) return "overdue";
  if (dueYmd === todayYmd) return "today";
  return "upcoming";
};

