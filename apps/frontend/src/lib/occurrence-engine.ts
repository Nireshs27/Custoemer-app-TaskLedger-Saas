import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addWeeks,
  addYears,
} from "date-fns";
import type { RecurrenceData } from "@shared/recurrence-validation";
import {
  sanitizeRecurrenceForSave,
  normalizeRecurrenceForUi,
  safeParseRecurrenceJson,
} from "./recurrence-utils";

type OffsetUnit = "minutes" | "hours" | "days";

export type OccurrenceEngineInput = {
  recurrence: unknown;
  seriesStart: Date;
  count: number;
  taskTimeIst: string;
  reminderOffsetValue: number;
  reminderOffsetUnit: OffsetUnit;
  reminderSendTimeIst: string;
};

export type TaskReminderOccurrence = {
  index: number;
  taskDateUtcIso: string;
  reminderDateUtcIso: string;
};

const VALID_WEEKDAY = (value: number) => value >= 0 && value <= 6;

const normalizeWeekDays = (weekDays?: number[]): number[] => {
  if (!Array.isArray(weekDays) || weekDays.length === 0) {
    return [];
  }
  return Array.from(new Set(weekDays.filter((day) => VALID_WEEKDAY(day)))).sort(
    (a, b) => a - b
  );
};

const applyIstTimeToUtcDate = (base: Date, istTime: string): Date => {
  const result = new Date(base);
  const [hoursStr, minutesStr] = istTime.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return result;
  }

  // Convert IST (UTC+5:30) to UTC clock time
  let totalMinutes = hours * 60 + minutes - 330;
  let dayAdjustment = 0;
  while (totalMinutes < 0) {
    totalMinutes += 1440;
    dayAdjustment -= 1;
  }
  while (totalMinutes >= 1440) {
    totalMinutes -= 1440;
    dayAdjustment += 1;
  }

  const utcHours = Math.floor(totalMinutes / 60);
  const utcMinutes = totalMinutes % 60;

  result.setUTCDate(result.getUTCDate() + dayAdjustment);
  result.setUTCHours(utcHours, utcMinutes, 0, 0);
  return result;
};

const adjustDateByOffset = (
  date: Date,
  value: number,
  unit: OffsetUnit,
  direction: 1 | -1
): Date => {
  if (!value) return new Date(date);
  const multiplier =
    unit === "minutes"
      ? 60 * 1000
      : unit === "hours"
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return new Date(date.getTime() + direction * value * multiplier);
};

const deriveOrdinalFromDate = (date: Date, weekday: number) => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const firstOccurrenceDate = 1 + offset;
  const occurrenceIndex = Math.floor((date.getDate() - firstOccurrenceDate) / 7) + 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const willExceedMonth = date.getDate() + 7 > daysInMonth;
  if (willExceedMonth) return "last";
  const map = ["first", "second", "third", "fourth"] as const;
  return map[Math.max(0, Math.min(map.length - 1, occurrenceIndex - 1))];
};

const getDaysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

const applyTimeFrom = (source: Date, target: Date) => {
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds()
  );
};

const getNthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  ordinal: string,
  timeSource: Date
): Date => {
  const ORDINAL_INDEX: Record<string, number> = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    last: -1,
  };

  if (ordinal === "last") {
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - weekday + 7) % 7;
    lastDay.setDate(lastDay.getDate() - diff);
    applyTimeFrom(timeSource, lastDay);
    return lastDay;
  }

  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  let day = 1 + offset + (ORDINAL_INDEX[ordinal] ?? 0) * 7;
  const daysInMonth = getDaysInMonth(year, month);
  if (day > daysInMonth) {
    day -= 7;
  }
  const candidate = new Date(year, month, Math.min(day, daysInMonth));
  applyTimeFrom(timeSource, candidate);
  return candidate;
};

const findNextWeeklyDate = (
  lastDate: Date,
  recurrenceData: RecurrenceData,
  anchorDate: Date
): Date => {
  const normalizedWeekDays = normalizeWeekDays((recurrenceData as any).weekDays);
  const interval = Math.max(1, recurrenceData.interval);
  const activeWeekDays = normalizedWeekDays.length > 0 ? normalizedWeekDays : [anchorDate.getDay()];

  const candidate = new Date(lastDate);

  for (let guard = 0; guard < 366 * interval; guard++) {
    candidate.setDate(candidate.getDate() + 1);
    const weekday = candidate.getDay();
    if (!activeWeekDays.includes(weekday)) {
      continue;
    }
    const weeksSinceAnchor = Math.floor(
      (candidate.getTime() - anchorDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    if (weeksSinceAnchor % interval === 0) {
      return candidate;
    }
  }

  return addWeeks(lastDate, interval);
};

const getNextMonthlyNthWeekday = (
  currentDate: Date,
  interval: number,
  recurrence: RecurrenceData
): Date => {
  const weekday =
    typeof (recurrence as any).monthlyWeekday === "number"
      ? (recurrence as any).monthlyWeekday
      : currentDate.getDay();
  const ordinal =
    typeof (recurrence as any).monthlyOrdinal === "string"
      ? (recurrence as any).monthlyOrdinal
      : deriveOrdinalFromDate(currentDate, weekday);

  const nextAnchor = new Date(currentDate);
  nextAnchor.setDate(1);
  nextAnchor.setMonth(nextAnchor.getMonth() + interval);
  return getNthWeekdayOfMonth(nextAnchor.getFullYear(), nextAnchor.getMonth(), weekday, ordinal, currentDate);
};

const getNextMonthlyDateBased = (
  currentDate: Date,
  interval: number,
  recurrence: RecurrenceData
): Date => {
  const targetDay =
    typeof (recurrence as any).monthlyDate === "number"
      ? (recurrence as any).monthlyDate
      : currentDate.getDate();
  const nextAnchor = new Date(currentDate);
  nextAnchor.setDate(1);
  nextAnchor.setMonth(nextAnchor.getMonth() + interval);
  const daysInMonth = getDaysInMonth(nextAnchor.getFullYear(), nextAnchor.getMonth());
  const safeDay = Math.min(Math.max(1, targetDay), daysInMonth);
  const candidate = new Date(nextAnchor.getFullYear(), nextAnchor.getMonth(), safeDay);
  applyTimeFrom(currentDate, candidate);
  return candidate;
};

function computeOccurrences(
  recurrence: RecurrenceData | null,
  seriesStart: Date,
  count: number
): Date[] {
  if (!recurrence) return [];
  const normalized = normalizeRecurrenceForUi(recurrence, seriesStart);
  if (!normalized || !normalized.pattern || !normalized.interval) {
    return [];
  }

  const { pattern, interval } = normalized;
  const occurrences: Date[] = [];
  let currentDate = new Date(seriesStart);
  const anchorDate = new Date(seriesStart);

  occurrences.push(new Date(currentDate));

  for (let i = 1; i < count; i++) {
    switch (pattern) {
      case "minutely":
        currentDate = addMinutes(currentDate, interval);
        break;
      case "hourly":
        currentDate = addHours(currentDate, interval);
        break;
      case "daily":
        currentDate = addDays(currentDate, interval);
        break;
      case "weekly":
        currentDate = findNextWeeklyDate(currentDate, normalized, anchorDate);
        break;
      case "monthly": {
        const monthlyType = (normalized as any).monthlyType;
        if (monthlyType === "day" || monthlyType === "ordinal") {
          currentDate = getNextMonthlyNthWeekday(currentDate, interval, normalized);
        } else {
          currentDate = getNextMonthlyDateBased(currentDate, interval, normalized);
        }
        break;
      }
      case "quarterly":
        currentDate = addMonths(currentDate, interval * 3);
        break;
      case "half-yearly":
        currentDate = addMonths(currentDate, interval * 6);
        break;
      case "yearly":
        currentDate = addYears(currentDate, interval);
        break;
      default:
        return occurrences;
    }

    occurrences.push(new Date(currentDate));
  }

  return occurrences;
}

export function buildTaskOccurrences(input: {
  recurrence: unknown;
  seriesStart: Date;
  count: number;
  taskTimeIst: string;
}): { recurrence: RecurrenceData | null; taskDatesUtc: Date[] } {
  const parsed = safeParseRecurrenceJson(input.recurrence);
  const sanitized =
    sanitizeRecurrenceForSave(parsed ?? input.recurrence, input.seriesStart) ??
    normalizeRecurrenceForUi(parsed, input.seriesStart);

  if (!sanitized) {
    return { recurrence: null, taskDatesUtc: [] };
  }

  const baseStart = new Date(input.seriesStart);
  const startWithTime = applyIstTimeToUtcDate(baseStart, input.taskTimeIst);
  const recurrenceWithStart: RecurrenceData = {
    ...sanitized,
    startDate: sanitized.startDate ?? startWithTime.toISOString(),
  };

  const taskDatesUtc = computeOccurrences(recurrenceWithStart, startWithTime, input.count);
  return { recurrence: recurrenceWithStart, taskDatesUtc };
}

export function buildTaskAndReminderOccurrences(
  input: OccurrenceEngineInput
): { recurrence: RecurrenceData | null; occurrences: TaskReminderOccurrence[] } {
  const { recurrence, seriesStart, count, taskTimeIst, reminderOffsetValue, reminderOffsetUnit, reminderSendTimeIst } =
    input;

  const { recurrence: normalizedRecurrence, taskDatesUtc } = buildTaskOccurrences({
    recurrence,
    seriesStart,
    count,
    taskTimeIst,
  });

  if (!normalizedRecurrence || taskDatesUtc.length === 0) {
    return { recurrence: normalizedRecurrence, occurrences: [] };
  }

  const firstTask = taskDatesUtc[0];
  const baseReminder = applyIstTimeToUtcDate(
    adjustDateByOffset(firstTask, reminderOffsetValue, reminderOffsetUnit, -1),
    reminderSendTimeIst
  );

  const occurrences: TaskReminderOccurrence[] = taskDatesUtc.map((taskDate, index) => {
    const delta = taskDate.getTime() - firstTask.getTime();
    const reminderDate = new Date(baseReminder.getTime() + delta);
    return {
      index,
      taskDateUtcIso: taskDate.toISOString(),
      reminderDateUtcIso: reminderDate.toISOString(),
    };
  });

  return { recurrence: normalizedRecurrence, occurrences };
}

export function buildPreviewIsoStrings(input: {
  recurrence: unknown;
  seriesStart: Date;
  count: number;
  taskTimeIst: string;
}): string[] {
  const { taskDatesUtc } = buildTaskOccurrences(input);
  return taskDatesUtc.map((d) => d.toISOString());
}

