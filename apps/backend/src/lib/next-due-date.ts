import { getNextOccurrence, parseRecurrenceData } from "@shared/recurrence-calculator";
import type { RecurrenceData } from "@shared/recurrence-calculator";

const toDate = (v: any): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function computeInitialNextDueDate(params: {
  dueDate?: string | Date | null;
  recurrenceData?: any;
  now?: Date;
}): string | null {
  const due = toDate(params.dueDate);
  const rec = parseRecurrenceData(params.recurrenceData);
  if (!rec || !due) return null;

  // Use the startDate from recurrenceData if available, otherwise use dueDate
  const startDate = rec.startDate ? toDate(rec.startDate) : due;
  if (!startDate) return toYmd(due);

  // Return the first occurrence (startDate) without clamping
  // This allows past occurrences to be generated
  return toYmd(startDate);
}

export function computeNextDueDateAfterCompletion(params: {
  dueDate?: string | Date | null;
  nextDueDate?: string | Date | null;
  recurrenceData?: any;
  completedOn?: string | Date | null;
}): string | null {
  const rec = parseRecurrenceData(params.recurrenceData);
  const due = toDate(params.dueDate);
  if (!rec || !due) return null;

  const completedDate =
    toDate(params.completedOn) ||
    toDate(params.nextDueDate) ||
    due;
  if (!completedDate) return null;

  let cursor = new Date(completedDate);
  let safety = 0;
  while (safety < 400) {
    cursor = getNextOccurrence(cursor, rec);
    safety += 1;
    if (!cursor) break;
    // Stop at the first occurrence strictly after completed occurrence
    if (stripTime(cursor) > stripTime(completedDate)) {
      return toYmd(cursor);
    }
  }
  return null;
}

function stripTime(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function toYmd(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

