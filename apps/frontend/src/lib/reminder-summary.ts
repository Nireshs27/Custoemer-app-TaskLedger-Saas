import { format } from "date-fns";
import { getNextOccurrence, type RecurrenceData as SharedRecurrenceData } from "@shared/recurrence-calculator";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface RecurrenceSummaryInput {
  startDate: Date;
  endDate?: Date | null;
  totalCount?: number | null;
  recurrenceData?: Record<string, any> | null;
  reminderOffsetValue?: number | null;
  reminderOffsetUnit?: "minutes" | "hours" | "days" | null;
}

export interface RecurrenceSummaryText {
  patternLine: string;
  rangeLine?: string;
  reminderLine?: string;
}

const formatDate = (date: Date | null | undefined) =>
  date ? format(date, "MMM d, yyyy") : undefined;

const pluralize = (count: number, unit: string) => {
  if (count === 1) {
    return unit;
  }
  return `${unit}s`;
};

function formatWeeklyPattern(recurrenceData: any): string | null {
  const days = Array.isArray(recurrenceData?.weekDays)
    ? recurrenceData.weekDays
        .filter((d: number) => d >= 0 && d <= 6)
        .sort((a: number, b: number) => a - b)
    : [];
  if (!days.length) {
    return null;
  }
  const labels = days.map((d: number) => WEEKDAY_LABELS[d]);
  return ` on ${labels.join(", ")}`;
}

function formatMonthlyPattern(recurrenceData: any): string | null {
  const type = recurrenceData?.monthlyType;
  if (type === "ordinal" || type === "day") {
    const ordinal = recurrenceData?.monthlyOrdinal ?? "first";
    const weekday =
      typeof recurrenceData?.monthlyWeekday === "number"
        ? WEEKDAY_LABELS[recurrenceData.monthlyWeekday]
        : "day";
    const label = ordinal.replace(/^\w/, (c: string) => c.toUpperCase());
    return ` on the ${label} ${weekday}`;
  }
  if (typeof recurrenceData?.monthlyDate === "number") {
    return ` on day ${recurrenceData.monthlyDate}`;
  }
  return null;
}

function buildPatternText(recurrenceData?: Record<string, any> | null): string {
  if (!recurrenceData || !recurrenceData.pattern) {
    return "Recurring";
  }

  const pattern = recurrenceData.pattern;
  const interval = Math.max(1, Number(recurrenceData.interval) || 1);
  const base =
    interval === 1
      ? `Every ${pattern === "daily" ? "day" : pattern.replace("-", " ")}`
      : `Every ${interval} ${pluralize(interval, pattern.replace("-", " "))}`;

  if (pattern === "weekly") {
    const suffix = formatWeeklyPattern(recurrenceData);
    return suffix ? `${base}${suffix}` : base;
  }

  if (pattern === "monthly") {
    const suffix = formatMonthlyPattern(recurrenceData);
    return suffix ? `${base}${suffix}` : base;
  }

  return base;
}

function buildRangeLine(
  startDate: Date,
  endDate?: Date | null,
  totalCount?: number | null,
  endType?: string | null
): string | undefined {
  const start = formatDate(startDate);
  if (!start) {
    return undefined;
  }

  const parts = [`Starts ${start}`];
  
  if (endDate) {
    parts.push(`Ends ${formatDate(endDate)}`);
  } else if (endType === "never") {
    parts.push("Repeats indefinitely");
  }

  if (totalCount && totalCount > 0) {
    parts.push(`${totalCount} occurrence${totalCount === 1 ? "" : "s"}`);
  }

  return parts.join(" • ");
}

function buildReminderLine(
  reminderOffsetValue?: number | null,
  reminderOffsetUnit?: "minutes" | "hours" | "days" | null
): string | undefined {
  if (
    reminderOffsetValue === null ||
    reminderOffsetValue === undefined ||
    reminderOffsetValue < 0
  ) {
    return undefined;
  }

  const unit = reminderOffsetUnit ?? "days";
  const label = pluralize(reminderOffsetValue || 0, unit.slice(0, -1));
  if (reminderOffsetValue === 0) {
    return `Reminds on the day of each occurrence`;
  }

  return `Reminds ${reminderOffsetValue} ${label} before each occurrence`;
}

export function buildRecurrenceSummary(
  input: RecurrenceSummaryInput
): RecurrenceSummaryText {
  const patternLine = buildPatternText(input.recurrenceData);
  const rangeLine = buildRangeLine(
    input.startDate,
    input.endDate,
    input.totalCount,
    input.recurrenceData?.endType ?? null
  );
  const reminderOffsetValue =
    input.reminderOffsetValue ?? input.recurrenceData?.reminderDays;
  const reminderLine = buildReminderLine(
    reminderOffsetValue ?? null,
    input.reminderOffsetUnit ?? "days"
  );

  return {
    patternLine,
    rangeLine,
    reminderLine,
  };
}

type RecurringRangeInput = {
  startDate?: Date | string | null;
  recurrenceData?: Record<string, any> | null;
  totalOccurrences?: number | null;
};

type RecurringRange = {
  start: Date | null;
  end: Date | null;
  totalCount: number | null;
};

const normalizeDateInput = (value?: Date | string | null): Date | null => {
  if (!value) return null;
  const asDate = value instanceof Date ? value : new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
};

export function getRecurringStartEnd(
  recurrenceData: SharedRecurrenceData | null | undefined,
  baseDueDate: Date | string | null | undefined,
  totalOccurrences?: number | null
): RecurringRange {
  if (!recurrenceData) {
    return { start: normalizeDateInput(baseDueDate), end: null, totalCount: totalOccurrences ?? null };
  }

  const start =
    normalizeDateInput(recurrenceData.startDate) ??
    normalizeDateInput(baseDueDate);

  if (!start) {
    return { start: null, end: null, totalCount: totalOccurrences ?? null };
  }

  const normalized: SharedRecurrenceData = {
    pattern: recurrenceData.pattern,
    interval: Math.max(1, recurrenceData.interval || 1),
    weekDays: recurrenceData.weekDays,
    monthlyType: recurrenceData.monthlyType,
    monthlyDate: recurrenceData.monthlyDate,
    monthlyOrdinal: recurrenceData.monthlyOrdinal,
    monthlyWeekday: recurrenceData.monthlyWeekday,
    quarterlyType: recurrenceData.quarterlyType,
    quarterlyMonth: recurrenceData.quarterlyMonth,
    quarterlyDate: recurrenceData.quarterlyDate,
    quarterStartMonth: recurrenceData.quarterStartMonth,
    halfYearlyType: recurrenceData.halfYearlyType,
    halfYearlyMonth: recurrenceData.halfYearlyMonth,
    halfYearlyDate: recurrenceData.halfYearlyDate,
    halfYearStartMonth: recurrenceData.halfYearStartMonth,
    endType: recurrenceData.endType ?? "never",
    endDate: recurrenceData.endDate,
    endCount: recurrenceData.endCount,
  };

  const totalCount =
    totalOccurrences ??
    (typeof recurrenceData.endCount === "number"
      ? recurrenceData.endCount
      : null);

  if (totalCount && totalCount > 0) {
    let cursor = new Date(start);
    for (let i = 1; i < totalCount; i++) {
      cursor = getNextOccurrence(cursor, normalized);
    }
    return { start, end: cursor, totalCount };
  }

  const endFromEndDate = normalizeDateInput(recurrenceData.endDate);
  return { start, end: endFromEndDate, totalCount };
}

