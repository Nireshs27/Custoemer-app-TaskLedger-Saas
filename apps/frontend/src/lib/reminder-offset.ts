import type { ReminderOffsetUnit as SharedReminderOffsetUnit } from "@shared/reminders-spec";

export type ReminderOffsetUnit = SharedReminderOffsetUnit;

export const DEFAULT_REMINDER_OFFSET_VALUE = 7;
export const DEFAULT_REMINDER_OFFSET_UNIT: ReminderOffsetUnit = "days";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

export const convertOffsetToDaysEstimate = (
  value: number,
  unit: ReminderOffsetUnit
) => {
  if (unit === "minutes") {
    return value / MINUTES_PER_DAY;
  }
  if (unit === "hours") {
    return (value * MINUTES_PER_HOUR) / MINUTES_PER_DAY;
  }
  return value;
};

export const toLegacyReminderDays = (
  value: number,
  unit: ReminderOffsetUnit
) => {
  const days = convertOffsetToDaysEstimate(value, unit);
  return Math.max(1, Math.round(days));
};

export const formatOffsetSummary = (
  value?: number,
  unit?: ReminderOffsetUnit
) => {
  const safeValue = typeof value === "number" && value > 0 ? value : 1;
  const safeUnit = unit ?? "minutes";
  const label =
    safeUnit === "minutes"
      ? safeValue === 1
        ? "minute"
        : "minutes"
      : safeUnit === "hours"
      ? safeValue === 1
        ? "hour"
        : "hours"
      : safeValue === 1
      ? "day"
      : "days";
  return `${safeValue} ${label}`;
};

