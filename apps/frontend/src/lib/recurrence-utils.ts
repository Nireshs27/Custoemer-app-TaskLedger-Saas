
/**
 * Recurrence Utility Functions
 * 
 * Shared utilities for calculating next occurrence dates
 * Used across all recurrence forms in the application
 */

import {
  addMinutes,
  addHours,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  differenceInCalendarWeeks,
  format,
} from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import type { RecurrenceData } from "@shared/recurrence-validation";
import type { RecurrenceMonthlyOrdinal } from "@shared/recurrence-constants";

const VALID_WEEKDAY = (value: number) => value >= 0 && value <= 6;

const ORDINAL_INDEX: Record<RecurrenceMonthlyOrdinal, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  last: -1,
};

const normalizeWeekDays = (weekDays?: number[]): number[] => {
  if (!Array.isArray(weekDays) || weekDays.length === 0) {
    return [];
  }
  return Array.from(new Set(weekDays.filter((day) => VALID_WEEKDAY(day)))).sort((a, b) => a - b);
};

export function safeParseRecurrenceJson(raw: unknown): any | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      // ✅ Handle legacy "double-stringified" JSON values safely.
      // Example from DB: "\"{\\\"pattern\\\":\\\"daily\\\",...}\""
      const once = JSON.parse(raw);
      if (typeof once === "string") {
        try {
          // Always return an object (or null). Never return a string to avoid UI crashes.
          return JSON.parse(once);
        } catch {
          return null;
        }
      }
      return once ?? null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw;
  }
  return null;
}

const deriveOrdinalFromDate = (date: Date, weekday: number): RecurrenceMonthlyOrdinal => {
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

const applyTimeFrom = (source: Date, target: Date) => {
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds()
  );
};

const getDaysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();

const getNthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  ordinal: RecurrenceMonthlyOrdinal,
  timeSource: Date
): Date => {
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

export function normalizeRecurrenceForUi(
  recurrence: any,
  seriesStart: Date
): RecurrenceData | null {
  if (!recurrence || typeof recurrence !== "object") return null;
  if (!recurrence.pattern || !recurrence.interval) return null;

  const canonical: any = { ...recurrence };
  const pattern = canonical.pattern;

  if (pattern !== "monthly") {
    return canonical as RecurrenceData;
  }

  // Normalize monthly types: treat "ordinal" and "day" as the nth-weekday mode
  const rawType = canonical.monthlyType;
  let monthlyType: "date" | "day" =
    rawType === "ordinal" ? "day" : rawType === "day" ? "day" : "date";

  // If monthlyType is already "date", keep it; otherwise, allow ordinal fields to force nth-weekday mode
  if (monthlyType !== "date" && (canonical.monthlyOrdinal || canonical.monthlyWeekday !== undefined)) {
    monthlyType = "day";
  }

  if (monthlyType === "date") {
    // Strip conflicting ordinal fields when in date mode
    delete canonical.monthlyOrdinal;
    delete canonical.monthlyWeekday;
    // weekDays should not influence monthly date mode
    delete canonical.weekDays;

    const day =
      typeof canonical.monthlyDate === "number" && canonical.monthlyDate >= 1 && canonical.monthlyDate <= 31
        ? canonical.monthlyDate
        : seriesStart.getDate();
    return {
      ...canonical,
      monthlyType: "date",
      monthlyDate: day,
    } as RecurrenceData;
  }

  // nth-weekday mode
  // Strip conflicting date field when in ordinal/day mode
  delete canonical.monthlyDate;

  const weekday =
    typeof canonical.monthlyWeekday === "number" && VALID_WEEKDAY(canonical.monthlyWeekday)
      ? canonical.monthlyWeekday
      : seriesStart.getDay();
  const ordinal: RecurrenceMonthlyOrdinal =
    typeof canonical.monthlyOrdinal === "string"
      ? canonical.monthlyOrdinal
      : deriveOrdinalFromDate(seriesStart, weekday);

  return {
    ...canonical,
    monthlyType: "day",
    monthlyWeekday: weekday,
    monthlyOrdinal: ordinal,
  } as RecurrenceData;
}

/**
 * Sanitize recurrence before saving to the server.
 * Guarantees canonical monthly shapes and required fields.
 */
export function sanitizeRecurrenceForSave(
  raw: unknown,
  seriesStart: Date
): RecurrenceData | null {
  const parsed = safeParseRecurrenceJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.pattern || !parsed.interval) return null;

  // Reuse UI normalization rules, then strip dev-only properties
  const normalized = normalizeRecurrenceForUi(parsed, seriesStart);
  if (!normalized) return null;

  // Remove any lingering extraneous fields not in the shared type
  const {
    pattern,
    interval,
    endType,
    endDate,
    endCount,
    startDate,
    weekDays,
    monthlyType,
    monthlyDate,
    monthlyOrdinal,
    monthlyWeekday,
    quarterlyMonth,
    quarterlyDate,
    halfYearlyMonth,
    halfYearlyDate,
    yearlyMonth,
    yearlyDate,
  } = normalized as any;

  const clean: RecurrenceData = {
    pattern,
    interval,
    endType: endType ?? "never",
    endDate,
    endCount,
    startDate,
  } as RecurrenceData;

  if (pattern === "weekly") {
    clean.weekDays = Array.isArray(weekDays) ? weekDays : undefined;
  }

  if (pattern === "monthly") {
    if (monthlyType === "date") {
      clean.monthlyType = "date";
      clean.monthlyDate = monthlyDate;
    } else {
      clean.monthlyType = "day";
      clean.monthlyOrdinal = monthlyOrdinal;
      clean.monthlyWeekday = monthlyWeekday;
    }
  }

  if (pattern === "quarterly") {
    clean.quarterlyMonth = quarterlyMonth;
    clean.quarterlyDate = quarterlyDate;
  }
  if (pattern === "half-yearly") {
    clean.halfYearlyMonth = halfYearlyMonth;
    clean.halfYearlyDate = halfYearlyDate;
  }
  if (pattern === "yearly") {
    clean.yearlyMonth = yearlyMonth;
    clean.yearlyDate = yearlyDate;
  }

  return clean;
}

const findNextWeeklyDate = (
  lastDate: Date,
  recurrenceData: RecurrenceData,
  anchorDate: Date
): Date => {
  const normalizedWeekDays = normalizeWeekDays((recurrenceData as any).weekDays);
  const interval = Math.max(1, recurrenceData.interval);
  const activeWeekDays =
    normalizedWeekDays.length > 0 ? normalizedWeekDays : [anchorDate.getDay()];

  const candidate = new Date(lastDate);

  for (let guard = 0; guard < 366 * interval; guard++) {
    candidate.setDate(candidate.getDate() + 1);
    const weekday = candidate.getDay();
    if (!activeWeekDays.includes(weekday)) {
      continue;
    }
    const weeksSinceAnchor = differenceInCalendarWeeks(candidate, anchorDate, { weekStartsOn: 0 });
    if (weeksSinceAnchor % interval === 0) {
      return candidate;
    }
  }

  // Fallback - should never hit but prevents infinite loops
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
  const ordinal: RecurrenceMonthlyOrdinal =
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

/**
 * Calculate the next N occurrence dates based on recurrence pattern
 * 
 * @param recurrenceData - The recurrence configuration
 * @param startDate - The starting date for recurrence (usually due date)
 * @param count - Number of future occurrences to calculate (default: 3)
 * @returns Array of formatted date strings
 */
export function calculateNextOccurrences(
  recurrenceData: RecurrenceData | null | undefined,
  startDate: Date,
  count: number = 3
): string[] {
  const normalized = normalizeRecurrenceForUi(recurrenceData, startDate);
  if (!normalized || !normalized.pattern || !normalized.interval) {
    return [];
  }

  const { pattern, interval } = normalized;
  const occurrences: string[] = [];
  let currentDate = new Date(startDate);
  const anchorDate = new Date(startDate);

  for (let i = 0; i < count; i++) {
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

    const formattedDate = format(currentDate, "MMM d, yyyy h:mm a");
    occurrences.push(formattedDate);
  }

  return occurrences;
}

/**
 * Get a human-readable recurrence description
 * 
 * @param recurrenceData - The recurrence configuration
 * @returns Human-readable description string
 */
export function getRecurrenceDescription(
  recurrenceData: RecurrenceData | null | undefined
): string {
  const fallbackStart = recurrenceData?.startDate
    ? new Date(recurrenceData.startDate as any)
    : new Date();
  const normalized = normalizeRecurrenceForUi(recurrenceData, fallbackStart);
  if (!normalized || !normalized.pattern || !normalized.interval) {
    return "";
  }

  const { pattern, interval } = normalized;

  const pluralize = (singular: string, plural: string) =>
    interval === 1 ? singular : plural;

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ordinalLabels: Record<string, string> = {
    first: "First",
    second: "Second",
    third: "Third",
    fourth: "Fourth",
    last: "Last",
  };

  const deriveOrdinal = (
    startDate: string | Date | undefined,
    weekday: number
  ): string | undefined => {
    if (!startDate) return undefined;
    const date = new Date(startDate);
    if (Number.isNaN(date.getTime())) return undefined;
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

  switch (pattern) {
    case "minutely":
      return `Every ${interval} ${pluralize("minute", "minutes")}`;
    case "hourly":
      return `Every ${interval} ${pluralize("hour", "hours")}`;
    case "daily":
      return `Every ${interval} ${pluralize("day", "days")}`;
    case "weekly": {
      const days =
        Array.isArray((normalized as any).weekDays) && (normalized as any).weekDays.length > 0
          ? (normalized as any).weekDays
              .map((d: number) => weekdayNames[d] ?? "")
              .filter(Boolean)
          : [];
      if (days.length > 0) {
        return `Every ${interval} ${pluralize("week", "weeks")} on ${days.join(", ")}`;
      }
      return `Every ${interval} ${pluralize("week", "weeks")}`;
    }
    case "monthly": {
      const type = (normalized as any).monthlyType;
      if (type === "date" && typeof (normalized as any).monthlyDate === "number") {
        return `Every ${interval} ${pluralize("month", "months")} on day ${(normalized as any).monthlyDate}`;
      }

      if (type === "ordinal" || type === "day") {
        const weekday =
          typeof (normalized as any).monthlyWeekday === "number"
            ? (normalized as any).monthlyWeekday
            : new Date((normalized as any).startDate ?? Date.now()).getDay();
        const ordinal =
          (normalized as any).monthlyOrdinal ||
          deriveOrdinal((normalized as any).startDate, weekday);

        if (ordinal && weekdayNames[weekday]) {
          const ordinalLabel = ordinalLabels[ordinal] ?? ordinal;
          return `Every ${interval} ${pluralize("month", "months")} on the ${ordinalLabel} ${weekdayNames[weekday]}`;
        }
      }

      return `Every ${interval} ${pluralize("month", "months")}`;
    }
    case "quarterly":
      return `Every ${interval} ${pluralize("quarter", "quarters")}`;
    case "half-yearly":
      return `Every ${interval} ${pluralize("half-year", "half-years")}`;
    case "yearly":
      return `Every ${interval} ${pluralize("year", "years")}`;
    default:
      return "";
  }
}

export interface RecurrencePreviewPayload {
  startDate: string;
  occurrenceTime?: string;
  recurrenceData: Record<string, any>;
  count?: number;
}

export interface RecurrencePreviewResponse {
  occurrences: string[];
}

export function fetchRecurrencePreview(
  payload: RecurrencePreviewPayload
): Promise<RecurrencePreviewResponse> {
  return apiRequest("POST", "/api/recurrence/preview", payload);
}

