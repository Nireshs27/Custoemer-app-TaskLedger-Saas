import {
  type RecurrencePattern,
  type RecurrenceMonthlyType,
  type RecurrenceMonthlyOrdinal,
  type RecurrenceEndType,
} from "./recurrence-constants";

/**
 * Recurrence Calculator for Recurring Tasks
 * Calculates all occurrence dates for recurring tasks
 * Follows DRY principles - reusable across all entity types
 *
 * Recurrence model overview:
 * - pattern + interval define cadence (minute, hour, day, week, month, quarter, half-year, year)
 * - weekDays[] (0-6) restrict weekly schedules to specific days
 * - monthlyType controls fixed date (monthlyDate) vs ordinal weekday (monthlyOrdinal + monthlyWeekday)
 * - quarterly / half-yearly options currently use interval math but share the same data envelope
 */

export interface RecurrenceData {
  pattern: RecurrencePattern;
  interval: number;
  time?: string; // HH:MM format
  weekDays?: number[]; // 0=Sunday, 1=Monday, etc.
  monthlyType?: RecurrenceMonthlyType; // 'day' kept for backwards compatibility (alias of 'ordinal')
  monthlyDate?: number;
  monthlyOrdinal?: RecurrenceMonthlyOrdinal;
  monthlyWeekday?: number;
  quarterlyType?: 'specific_date' | 'end_of_quarter' | 'end_of_following_month';
  quarterlyMonth?: 1 | 2 | 3;
  quarterlyDate?: number;
  quarterStartMonth?: 1 | 4 | 7 | 10;
  halfYearlyType?: 'specific_date' | 'end_of_half_year' | 'end_of_following_month';
  halfYearlyMonth?: 1 | 2 | 3 | 4 | 5 | 6;
  halfYearlyDate?: number;
  halfYearStartMonth?: 4 | 10;
  endType: RecurrenceEndType;
  endDate?: Date | string;
  endCount?: number;
  // ⚠️ DEPRECATED: This field is IGNORED by the calculator
  // The actual start date comes from the task's due_date field (industry standard)
  // See: https://github.com/yourrepo/issues/XXX
  startDate?: Date | string; // Optional and IGNORED - use due_date instead!
}

const WEEK_IN_DAYS = 7;

const ORDINAL_INDEX: Record<'first' | 'second' | 'third' | 'fourth', number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
};

const VALID_WEEK_DAY = (value: number) => value >= 0 && value <= 6;

const normalizeWeekDays = (weekDays?: number[]): number[] => {
  if (!Array.isArray(weekDays) || weekDays.length === 0) {
    return [];
  }
  return Array.from(new Set(weekDays.filter((day) => VALID_WEEK_DAY(day)))).sort((a, b) => a - b);
};

const applyTimeFrom = (source: Date, target: Date): Date => {
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds()
  );
  return target;
};

const getDaysInMonth = (date: Date): number => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
};

const normalizeMonthlyType = (type?: string): 'date' | 'ordinal' => {
  if (type === 'ordinal' || type === 'day') {
    return 'ordinal';
  }
  return 'date';
};

const getLastWeekdayOfMonth = (year: number, month: number, weekday: number): Date => {
  const lastDay = new Date(year, month + 1, 0);
  const diff = (lastDay.getDay() - weekday + WEEK_IN_DAYS) % WEEK_IN_DAYS;
  lastDay.setDate(lastDay.getDate() - diff);
  return lastDay;
};

const getNthWeekdayOfMonth = (
  year: number,
  month: number,
  weekday: number,
  ordinal: RecurrenceData['monthlyOrdinal']
): Date => {
  if (ordinal === 'last') {
    return getLastWeekdayOfMonth(year, month, weekday);
  }

  const nthIndex = ORDINAL_INDEX[ordinal ?? 'first'] ?? 0;
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const offset = (weekday - firstWeekday + WEEK_IN_DAYS) % WEEK_IN_DAYS;
  let day = 1 + offset + (nthIndex * WEEK_IN_DAYS);
  const daysInMonth = getDaysInMonth(firstDay);
  if (day > daysInMonth) {
    day -= WEEK_IN_DAYS;
  }
  return new Date(year, month, Math.min(day, daysInMonth));
};

const getNextWeeklyOccurrence = (currentDate: Date, recurrence: RecurrenceData): Date => {
  const days = normalizeWeekDays(recurrence.weekDays);
  if (days.length === 0) {
    const fallback = new Date(currentDate);
    fallback.setDate(fallback.getDate() + (recurrence.interval * WEEK_IN_DAYS));
    return fallback;
  }

  const currentDay = currentDate.getDay();
  const nextDayThisWeek = days.find((day) => day > currentDay);
  const result = new Date(currentDate);

  if (nextDayThisWeek !== undefined) {
    result.setDate(result.getDate() + (nextDayThisWeek - currentDay));
    return result;
  }

  const intervalWeeks = Math.max(1, recurrence.interval);
  const daysToAdd =
    (WEEK_IN_DAYS - currentDay) + ((intervalWeeks - 1) * WEEK_IN_DAYS) + days[0];
  result.setDate(result.getDate() + daysToAdd);
  return result;
};

const getNextMonthlyOccurrence = (currentDate: Date, recurrence: RecurrenceData): Date => {
  const type = normalizeMonthlyType(recurrence.monthlyType);
  const interval = Math.max(1, recurrence.interval);

  const buildCandidate = (year: number, month: number): Date => {
    if (type === 'ordinal') {
      const weekday = typeof recurrence.monthlyWeekday === 'number'
        ? recurrence.monthlyWeekday
        : currentDate.getDay();
      const ordinal = recurrence.monthlyOrdinal ?? 'first';
      const candidate = getNthWeekdayOfMonth(
        year,
        month,
        weekday,
        ordinal
      );
      return applyTimeFrom(currentDate, candidate);
    }

    const targetDay = recurrence.monthlyDate ?? currentDate.getDate();
    const base = new Date(year, month, 1);
    const daysInMonth = getDaysInMonth(base);
    base.setDate(Math.min(targetDay, daysInMonth));
    return applyTimeFrom(currentDate, base);
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const thisMonthCandidate = buildCandidate(year, month);
  if (thisMonthCandidate > currentDate) {
    return thisMonthCandidate;
  }

  const nextAnchor = new Date(currentDate);
  nextAnchor.setDate(1);
  nextAnchor.setMonth(nextAnchor.getMonth() + interval);
  return buildCandidate(nextAnchor.getFullYear(), nextAnchor.getMonth());
};

export function doesDateMatchRecurrence(date: Date, recurrence: RecurrenceData): boolean {
  switch (recurrence.pattern) {
    case 'minutely':
    case 'hourly':
    case 'daily':
      return true;
    case 'weekly': {
      const days = normalizeWeekDays(recurrence.weekDays);
      if (days.length === 0) {
        return true;
      }
      return days.includes(date.getDay());
    }
    case 'monthly': {
      const type = normalizeMonthlyType(recurrence.monthlyType);
      if (type === 'ordinal') {
        const weekday = typeof recurrence.monthlyWeekday === 'number'
          ? recurrence.monthlyWeekday
          : date.getDay();
        const ordinal = recurrence.monthlyOrdinal ?? 'first';
        const candidate = getNthWeekdayOfMonth(
          date.getFullYear(),
          date.getMonth(),
          weekday,
          ordinal
        );
        return (
          candidate.getFullYear() === date.getFullYear() &&
          candidate.getMonth() === date.getMonth() &&
          candidate.getDate() === date.getDate()
        );
      }

      const targetDay = recurrence.monthlyDate ?? date.getDate();
      const daysInMonth = getDaysInMonth(date);
      const clamped = Math.min(targetDay, daysInMonth);
      return date.getDate() === clamped;
    }
    default:
      return true;
  }
}

/**
 * Calculate all occurrence dates for a recurring task
 * 
 * ⚡ IMPORTANT: This function uses the `startDate` parameter (from task's due_date),
 * NOT the `startDate` field in recurrenceData!
 * 
 * This follows industry standards:
 * - Google Calendar: Due date = First occurrence
 * - Todoist: Due date = First occurrence
 * - Outlook: Start date = First occurrence
 * - Apple Reminders: Due date = First occurrence
 * 
 * @param startDate - The initial due date (from task's due_date field) ← THIS IS USED!
 * @param recurrenceData - The recurrence pattern configuration (startDate in this object is IGNORED)
 * @param maxOccurrences - Safety limit to prevent infinite loops (default: 1000)
 * @returns Array of occurrence dates
 */
export function calculateOccurrenceDates(
  startDate: Date | string,
  recurrenceData: RecurrenceData,
  maxOccurrences: number = 1000
): Date[] {
  console.log('\n🔄 CALCULATING RECURRENCE OCCURRENCES');
  console.log('   ✅ Start Date (from due_date parameter):', startDate);
  console.log('   ⚠️  recurrenceData.startDate is IGNORED:', recurrenceData.startDate);
  console.log('   Recurrence Data:', JSON.stringify(recurrenceData, null, 2));

  const occurrences: Date[] = [];
  let currentDate = new Date(startDate);
  
  // ⚡ FIX: For date-only inputs, apply sensible default time
  // Check if startDate is date-only (no time component)
  const startDateStr = typeof startDate === 'string' ? startDate : startDate.toISOString();
  const hasTimeComponent = (
    startDateStr.includes('T') ||
    startDateStr.includes(':') ||
    startDateStr.includes('Z') ||
    /\d{2}:\d{2}/.test(startDateStr)
  );
  
  if (!hasTimeComponent) {
    // Date-only input: Apply 9:00 AM default
    // This ensures reminders are sent during active hours, not midnight
    console.log('   ⚡ Date-only input detected: Applying 9:00 AM default time');
    currentDate.setHours(9, 0, 0, 0);
    console.log('   ✅ First occurrence with time:', currentDate.toISOString());
  }
  
  // Add the first occurrence (start date)
  occurrences.push(new Date(currentDate));
  
  // Determine end condition
  const endDate = recurrenceData.endDate ? new Date(recurrenceData.endDate) : null;
  const endCount = recurrenceData.endCount || null;
  
  console.log('   End Type:', recurrenceData.endType);
  console.log('   End Date:', endDate?.toISOString());
  console.log('   End Count:', endCount);
  
  let iterationCount = 0;
  
  // Calculate subsequent occurrences
  while (iterationCount < maxOccurrences) {
    iterationCount++;
    
    // Calculate next occurrence date based on pattern
    const nextDate = getNextOccurrence(currentDate, recurrenceData);
    
    // Check end conditions
    if (recurrenceData.endType === 'on' && endDate && nextDate > endDate) {
      console.log(`   ⏹️  Stopped: Next date ${nextDate.toISOString()} exceeds end date ${endDate.toISOString()}`);
      break;
    }
    
    if (recurrenceData.endType === 'after' && endCount && occurrences.length >= endCount) {
      console.log(`   ⏹️  Stopped: Reached max occurrences (${endCount})`);
      break;
    }
    
    // For 'never', apply safety limit
    if (recurrenceData.endType === 'never' && occurrences.length >= 52) {
      console.log(`   ⚠️  Safety limit: Limiting 'never' ending tasks to 52 occurrences (1 year of weekly)`);
      break;
    }
    
    occurrences.push(new Date(nextDate));
    currentDate = nextDate;
  }
  
  console.log(`   ✅ Calculated ${occurrences.length} occurrences`);
  console.log(`   First occurrence: ${occurrences[0].toISOString()}`);
  console.log(`   Last occurrence: ${occurrences[occurrences.length - 1].toISOString()}`);
  
  return occurrences;
}

/**
 * Calculate the next occurrence date based on recurrence pattern
 */
export function getNextOccurrence(currentDate: Date, recurrence: RecurrenceData): Date {
  const next = new Date(currentDate);
  
  switch (recurrence.pattern) {
    case 'minutely':
      next.setMinutes(next.getMinutes() + recurrence.interval);
      break;
      
    case 'hourly':
      next.setHours(next.getHours() + recurrence.interval);
      break;
      
    case 'daily':
      next.setDate(next.getDate() + recurrence.interval);
      break;
      
    case 'weekly':
      return getNextWeeklyOccurrence(currentDate, recurrence);
      
    case 'monthly':
      return getNextMonthlyOccurrence(currentDate, recurrence);
      
    case 'quarterly':
      next.setMonth(next.getMonth() + (3 * recurrence.interval));
      break;
      
    case 'half-yearly':
      next.setMonth(next.getMonth() + (6 * recurrence.interval));
      break;
      
    case 'yearly':
      next.setFullYear(next.getFullYear() + recurrence.interval);
      break;
      
    default:
      throw new Error(`Unsupported recurrence pattern: ${recurrence.pattern}`);
  }
  
  return next;
}

/**
 * Helper to check if an item is recurring
 */
export function isRecurringItem(isRecurring: boolean | null, recurrenceData: any): boolean {
  return !!(isRecurring && recurrenceData);
}

/**
 * Parse recurrence data from JSONB field (handles both objects and JSON strings)
 */
export function parseRecurrenceData(recurrenceData: any): RecurrenceData | null {
  if (!recurrenceData) return null;
  
  if (typeof recurrenceData === 'object') {
    return recurrenceData as RecurrenceData;
  }
  
  if (typeof recurrenceData === 'string') {
    try {
      return JSON.parse(recurrenceData) as RecurrenceData;
    } catch (error) {
      console.error('Failed to parse recurrence data:', error);
      return null;
    }
  }
  
  return null;
}

