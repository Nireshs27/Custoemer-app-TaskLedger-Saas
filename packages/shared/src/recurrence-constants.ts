export const RECURRENCE_PATTERNS = [
  "minutely",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "half-yearly",
  "yearly",
] as const;
export type RecurrencePattern = (typeof RECURRENCE_PATTERNS)[number];

export const RECURRENCE_MONTHLY_TYPES = ["date", "ordinal", "day"] as const;
export type RecurrenceMonthlyType = (typeof RECURRENCE_MONTHLY_TYPES)[number];

export const RECURRENCE_MONTHLY_ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "last",
] as const;
export type RecurrenceMonthlyOrdinal = (typeof RECURRENCE_MONTHLY_ORDINALS)[number];

export const RECURRENCE_END_TYPES = ["never", "on", "after"] as const;
export type RecurrenceEndType = (typeof RECURRENCE_END_TYPES)[number];

