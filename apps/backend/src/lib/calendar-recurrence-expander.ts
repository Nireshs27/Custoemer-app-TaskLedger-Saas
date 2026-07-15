import {
  type RecurrencePattern,
  type RecurrenceMonthlyType,
  type RecurrenceMonthlyOrdinal,
  type RecurrenceEndType,
} from "@shared/recurrence-constants";

function addUnit(
  date: Date,
  pattern: RecurrencePattern,
  interval: number,
  recurrence?: RecurrenceData
): Date {
  const d = new Date(date.getTime());
  switch (pattern) {
    case "minutely":
      d.setMinutes(d.getMinutes() + interval);
      break;
    case "hourly":
      d.setHours(d.getHours() + interval);
      break;
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      return getNextWeeklyOccurrence(d, Math.max(1, interval), recurrence?.weekDays);
    case "monthly":
      return getNextMonthlyOccurrence(d, Math.max(1, interval), recurrence);
    case "quarterly":
      d.setMonth(d.getMonth() + 3 * interval);
      break;
    case "half-yearly":
      d.setMonth(d.getMonth() + 6 * interval);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + interval);
      break;
    default:
      // keep safe fallback (days) in case an unknown pattern arrives
      d.setDate(d.getDate() + interval);
      break;
  }
  return d;
}

function getNextWeeklyOccurrence(
  currentDate: Date,
  interval: number,
  weekDays?: number[]
): Date {
  const normalizedDays = Array.isArray(weekDays)
    ? Array.from(new Set(weekDays.filter((d) => d >= 0 && d <= 6))).sort(
        (a, b) => a - b
      )
    : [];

  // Fallback: no weekdays provided → simple weekly interval
  if (normalizedDays.length === 0) {
    const fallback = new Date(currentDate);
    fallback.setDate(fallback.getDate() + 7 * interval);
    return fallback;
  }

  const currentDay = currentDate.getDay(); // 0=Sun
  const nextDayThisWeek = normalizedDays.find((d) => d > currentDay);
  const result = new Date(currentDate);

  if (nextDayThisWeek !== undefined) {
    result.setDate(result.getDate() + (nextDayThisWeek - currentDay));
    return result;
  }

  // Move to the first configured weekday in the next interval week
  const daysToAdd = (7 - currentDay) + (interval - 1) * 7 + normalizedDays[0];
  result.setDate(result.getDate() + daysToAdd);
  return result;
}

function getNextMonthlyOccurrence(
  currentDate: Date,
  interval: number,
  recurrence?: RecurrenceData
): Date {
  const type = recurrence?.monthlyType ?? "date";
  const targetDay = recurrence?.monthlyDate ?? currentDate.getDate();
  const ordinal = recurrence?.monthlyOrdinal ?? "first";
  const weekday =
    typeof recurrence?.monthlyWeekday === "number"
      ? recurrence?.monthlyWeekday
      : currentDate.getDay();

  const buildCandidate = (year: number, month: number) => {
    if (type === "ordinal" || type === "day") {
      return getNthWeekdayOfMonth(year, month, weekday, ordinal, currentDate);
    }
    const daysInMonth = getDaysInMonth(year, month);
    const safeDay = Math.min(Math.max(1, targetDay), daysInMonth);
    const candidate = new Date(year, month, safeDay);
    applyTimeFrom(currentDate, candidate);
    return candidate;
  };

  const nextAnchor = new Date(currentDate);
  nextAnchor.setDate(1);
  nextAnchor.setMonth(nextAnchor.getMonth() + interval);
  return buildCandidate(nextAnchor.getFullYear(), nextAnchor.getMonth());
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const ORDINAL_INDEX: Record<RecurrenceMonthlyOrdinal, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  last: -1,
};

function getNthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: RecurrenceMonthlyOrdinal,
  timeSource: Date
): Date {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = getDaysInMonth(year, month);

  if (ordinal === "last") {
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - weekday + 7) % 7;
    lastDay.setDate(lastDay.getDate() - diff);
    applyTimeFrom(timeSource, lastDay);
    return lastDay;
  }

  const index = ORDINAL_INDEX[ordinal] ?? 0;
  const offset = (weekday - firstWeekday + 7) % 7;
  let day = 1 + offset + index * 7;
  if (day > daysInMonth) {
    day -= 7;
  }
  const candidate = new Date(year, month, Math.min(day, daysInMonth));
  applyTimeFrom(timeSource, candidate);
  return candidate;
}

function applyTimeFrom(source: Date, target: Date) {
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds()
  );
}


export interface RecurrenceData {
  pattern: RecurrencePattern;
  interval: number; // 1,2,3...
  endType: RecurrenceEndType | "onDate"; // Support both 'on' (frontend) and 'onDate' (legacy)
  endDate?: string; // ISO "YYYY-MM-DD" or full ISO
  endCount?: number; // number of occurrences including base
  startDate?: string; // ISO "YYYY-MM-DD" - original start date of the series
  weekDays?: number[];
  monthlyType?: RecurrenceMonthlyType;
  monthlyDate?: number;
  monthlyOrdinal?: RecurrenceMonthlyOrdinal;
  monthlyWeekday?: number; // 0=Sunday..6=Saturday
}

// Base item shape coming from storage.ts
export interface CalendarBaseItem {
  id: string;
  title: string;
  dueDate: Date;
  category: string;
  status: string;
  entityType: "tax" | "vehicle" | "asset" | "event" | "task_action_item" | "tax_legal_item";
  vehicleId?: string | null;
  vehicleName?: string | null;
  recurrenceData?: RecurrenceData | null;
}

// Returned to API / client
export interface CalendarItemWithOccurrences extends CalendarBaseItem {
  isRecurringOccurrence?: boolean;
  seriesMasterId?: string | null;
  occurrenceTaskDateUtcIso?: string | null;
}

/**
 * Main entry: expand all calendar items between rangeStart and rangeEnd.
 * - Includes base item if within range
 * - Adds virtual occurrences for recurring items
 * - Hard limits to avoid infinite loops
 */
export function expandCalendarItemsForRange(
  items: CalendarBaseItem[],
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrencesPerItem = 366
): CalendarItemWithOccurrences[] {
  const result: CalendarItemWithOccurrences[] = [];

  for (const item of items) {
    // 🔧 FIX: Ensure recurrenceData includes startDate for ALL items (including base)
    // This is critical for the UI to show correct start date, end date, and occurrence count
    const enrichedRecurrenceData = item.recurrenceData
      ? {
          ...item.recurrenceData,
          startDate:
            item.recurrenceData.startDate ??
            item.dueDate.toISOString(),
        }
      : null;

    const seriesStartDate =
      enrichedRecurrenceData?.startDate &&
      !Number.isNaN(new Date(enrichedRecurrenceData.startDate).getTime())
        ? new Date(enrichedRecurrenceData.startDate)
        : item.dueDate;

    const base: CalendarItemWithOccurrences = {
      ...item,
      dueDate: seriesStartDate,
      recurrenceData: enrichedRecurrenceData,
      isRecurringOccurrence: false,
      seriesMasterId: null,
      occurrenceTaskDateUtcIso: enrichedRecurrenceData ? seriesStartDate.toISOString() : null,
    };

    // 1) Always include base if inside the requested range
    if (seriesStartDate >= rangeStart && seriesStartDate <= rangeEnd) {
      result.push(base);
    }

    // 2) If no recurrence, continue
    const recurrence = enrichedRecurrenceData; // <<< USE ENRICHED DATA (was item.recurrenceData)
    if (!recurrence || !recurrence.pattern) {
      continue;
    }

    try {
      const occurrences = expandSingleItemOccurrences(
        base,
        recurrence,
        rangeStart,
        rangeEnd,
        maxOccurrencesPerItem
      );
      result.push(...occurrences);
    } catch (error) {
      console.error(
        `❌ Failed to expand recurrence for item ${item.id}`,
        error
      );
      // soft-fail: keep base only
    }
  }

  // Optional: sort by dueDate then title
  result.sort((a, b) => {
    const diff = a.dueDate.getTime() - b.dueDate.getTime();
    if (diff !== 0) return diff;
    return a.title.localeCompare(b.title);
  });

  return result;
}

function expandSingleItemOccurrences(
  base: CalendarItemWithOccurrences,
  recurrence: RecurrenceData,
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrences: number
): CalendarItemWithOccurrences[] {
  const occurrences: CalendarItemWithOccurrences[] = [];
  const seriesStart =
    recurrence.startDate && !Number.isNaN(new Date(recurrence.startDate).getTime())
      ? new Date(recurrence.startDate)
      : base.dueDate;

  // 🔧 Normalize monthly ordinal/weekDay for legacy rows missing fields
  const normalizedRecurrence = normalizeMonthlyRecurrence(recurrence, seriesStart);

  const interval = normalizeInterval(normalizedRecurrence.interval);
  const pattern = normalizedRecurrence.pattern;
  const hardStop = 5000; // safety loop guard

  const endDateLimit =
    (normalizedRecurrence.endType === "on" || normalizedRecurrence.endType === "onDate") &&
    normalizedRecurrence.endDate
      ? normalizeDate(normalizedRecurrence.endDate)
      : null;

  const maxCountLimit =
    normalizedRecurrence.endType === "after" &&
    normalizedRecurrence.endCount &&
    normalizedRecurrence.endCount > 0
      ? normalizedRecurrence.endCount
      : null;

  // We already have base occurrence at base.dueDate
  // Start generating from next occurrence
  let current = addUnit(seriesStart, pattern, interval, normalizedRecurrence);
  let generatedCount = 0;
  let occurrenceIndex = 2; // base is #1

  while (current <= rangeEnd && generatedCount < maxOccurrences && occurrenceIndex <= hardStop) {
    if (endDateLimit && current > endDateLimit) break;
    if (maxCountLimit && occurrenceIndex > maxCountLimit) break;

    if (current >= rangeStart) {
      // Stable unique id including time to prevent collisions for minutely/hourly patterns
      const occurrenceKey = current.toISOString(); // full ISO timestamp
      occurrences.push({
        ...base,
        id: `${base.id}::${occurrenceKey}`, // stable key per occurrence (per timestamp)
        dueDate: current,
        isRecurringOccurrence: true,
        seriesMasterId: base.id,
        occurrenceTaskDateUtcIso: occurrenceKey,
        // recurrenceData already has startDate from base (no need to add again)
      });
      generatedCount++;
    }

    occurrenceIndex++;
    current = addUnit(current, pattern, interval, normalizedRecurrence);
  }

  return occurrences;
}

function normalizeMonthlyRecurrence(
  recurrence: RecurrenceData,
  seriesStart: Date
): RecurrenceData {
  const needsOrdinal =
    recurrence.monthlyType === "ordinal" || recurrence.monthlyType === "day";
  if (!needsOrdinal) {
    return recurrence;
  }

  const hasWeekday = typeof recurrence.monthlyWeekday === "number";
  const derivedWeekday = hasWeekday ? recurrence.monthlyWeekday : seriesStart.getDay();
  const safeWeekday = typeof derivedWeekday === "number" ? derivedWeekday : seriesStart.getDay();

  const hasOrdinal = typeof recurrence.monthlyOrdinal === "string";
  const derivedOrdinal = hasOrdinal
    ? (recurrence.monthlyOrdinal as RecurrenceMonthlyOrdinal)
    : deriveOrdinalFromDate(seriesStart, safeWeekday);

  if (hasOrdinal && hasWeekday) {
    return recurrence;
  }

  return {
    ...recurrence,
    monthlyWeekday: safeWeekday,
    monthlyOrdinal: derivedOrdinal,
  };
}

function deriveOrdinalFromDate(
  date: Date,
  weekday: number
): RecurrenceMonthlyOrdinal {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = getDaysInMonth(year, month);

  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const firstOccurrenceDate = 1 + offset;

  const occurrenceIndex = Math.floor((date.getDate() - firstOccurrenceDate) / 7) + 1;
  const willExceedMonth = date.getDate() + 7 > daysInMonth;

  if (willExceedMonth) {
    return "last";
  }

  const ordinalMap: RecurrenceMonthlyOrdinal[] = [
    "first",
    "second",
    "third",
    "fourth",
  ];
  return ordinalMap[Math.max(0, Math.min(ordinalMap.length - 1, occurrenceIndex - 1))];
}

function normalizeInterval(interval?: number): number {
  const n = typeof interval === "number" && interval > 0 ? interval : 1;
  return Number.isFinite(n) ? n : 1;
}

function normalizeDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Allow "YYYY-MM-DD" or full ISO
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid recurrence endDate: ${value}`);
  }
  return d;
}