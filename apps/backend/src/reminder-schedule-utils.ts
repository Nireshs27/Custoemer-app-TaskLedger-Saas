import type { ReminderSchedule } from "@shared/schema";
import type { RecurrenceData } from "@shared/recurrence-validation";
import {
  REMINDER_OFFSET_UNITS,
  REMINDER_SCHEDULE_INVARIANTS,
  REMINDER_SCHEDULE_STATUSES,
  REMINDER_SCHEDULE_TYPES,
  type ReminderOffsetUnit,
  type ReminderScheduleRecord,
  type ReminderScheduleStatus,
  type ReminderScheduleType,
  type ReminderChannel,
} from "@shared/reminders-spec";
import { getNextOccurrence } from "@shared/recurrence-calculator";

const DEFAULT_REMINDER_TIME = "09:00";
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

export class ReminderScheduleInvariantError extends Error {
  constructor(
    public readonly details: string[],
    public readonly scheduleId?: string,
    context?: string
  ) {
    super(
      `Reminder schedule invariants failed${scheduleId ? ` for ${scheduleId}` : ""}${
        context ? ` (${context})` : ""
      }`
    );
    this.name = "ReminderScheduleInvariantError";
  }
}

const asReminderOffsetUnit = (value?: string | null): ReminderOffsetUnit => {
  if (value && REMINDER_OFFSET_UNITS.includes(value as ReminderOffsetUnit)) {
    return value as ReminderOffsetUnit;
  }
  return "days";
};

const asReminderScheduleType = (value?: string | null): ReminderScheduleType => {
  if (value && REMINDER_SCHEDULE_TYPES.includes(value as ReminderScheduleType)) {
    return value as ReminderScheduleType;
  }
  return "one_time";
};

const asReminderScheduleStatus = (
  value?: string | null
): ReminderScheduleStatus => {
  if (value && REMINDER_SCHEDULE_STATUSES.includes(value as ReminderScheduleStatus)) {
    return value as ReminderScheduleStatus;
  }
  return "pending";
};

const normalizeArray = (input: unknown, fallback: string[]): string[] => {
  if (Array.isArray(input)) {
    return input.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof input === "string" && input.trim().length > 0) {
    return [input.trim()];
  }
  return fallback;
};

const normalizeRecurrenceData = (
  value: unknown,
  scheduleType: ReminderScheduleType
): RecurrenceData | null => {
  if (!value || scheduleType === "one_time") {
    return null;
  }
  if (typeof value === "object") {
    const candidate = value as RecurrenceData;
    if (candidate.pattern) {
      return normalizeRecurrenceTokens(candidate);
    }
  }
  return null;
};

const normalizeRecurrenceTokens = (value: RecurrenceData): RecurrenceData => {
  const patternStr = String(value.pattern);
  const normalizedPattern =
    patternStr === "halfYearly" || patternStr === "halfyearly"
      ? ("half-yearly" as RecurrenceData["pattern"])
      : (value.pattern as RecurrenceData["pattern"]);

  const normalizedEndType =
    (value.endType as any) === "onDate" ? ("on" as RecurrenceData["endType"]) : value.endType;

  const normalizedMonthlyType =
    value.monthlyType === "day" ? ("ordinal" as RecurrenceData["monthlyType"]) : value.monthlyType;

  return {
    ...value,
    pattern: normalizedPattern,
    endType: normalizedEndType,
    monthlyType: normalizedMonthlyType,
  };
};

export function normalizeReminderSchedule(
  schedule: ReminderSchedule
): ReminderScheduleRecord {
  const scheduleType = asReminderScheduleType(schedule.scheduleType);
  const status = asReminderScheduleStatus(schedule.status);
  const reminderOffsetUnit = asReminderOffsetUnit(schedule.reminderOffsetUnit);
  const reminderOffsetValue =
    typeof schedule.reminderOffsetValue === "number" &&
    !Number.isNaN(schedule.reminderOffsetValue)
      ? schedule.reminderOffsetValue
      : typeof schedule.reminderDaysBefore === "number"
      ? schedule.reminderDaysBefore
      : null;
  const occurrencesSent =
    typeof schedule.occurrencesSent === "number" && schedule.occurrencesSent > 0
      ? schedule.occurrencesSent
      : 0;
  const occurrencesRemaining =
    schedule.occurrencesRemaining === null ||
    schedule.occurrencesRemaining === undefined
      ? null
      : Math.max(0, Number(schedule.occurrencesRemaining));
  const totalOccurrences =
    schedule.totalOccurrences === null || schedule.totalOccurrences === undefined
      ? null
      : Math.max(0, Number(schedule.totalOccurrences));
  const reminderTimes = normalizeArray(schedule.reminderTimes, [DEFAULT_REMINDER_TIME]);
  const notificationChannels = normalizeArray(
    schedule.notificationChannels,
    ["email"]
  ) as ReminderChannel[];
  const recipientEmail = normalizeArray(schedule.recipientEmail, []);
  const recipientPhone = normalizeArray(schedule.recipientPhone, []);
  const recurrenceData = normalizeRecurrenceData(schedule.recurrenceData, scheduleType);
  const reminderDate =
    schedule.reminderDate instanceof Date
      ? schedule.reminderDate
      : new Date(schedule.reminderDate ?? new Date().toISOString());
  const endDate =
    schedule.endDate instanceof Date || schedule.endDate === null
      ? schedule.endDate
      : schedule.endDate
      ? new Date(schedule.endDate)
      : null;

  return {
    ...(schedule as ReminderScheduleRecord),
    id: (schedule as ReminderScheduleRecord).id ?? PLACEHOLDER_ID,
    scheduleType,
    status,
    reminderOffsetUnit,
    reminderOffsetValue,
    occurrencesSent,
    occurrencesRemaining,
    totalOccurrences,
    reminderTimes,
    notificationChannels,
    recipientEmail,
    recipientPhone,
    recurrenceData,
    reminderDate,
    endDate,
    isActive: Boolean(schedule.isActive),
  };
}

export interface ReminderScheduleValidationOptions {
  context?: string;
}

export function validateReminderScheduleInvariants(
  schedule: ReminderSchedule | ReminderScheduleRecord,
  options: ReminderScheduleValidationOptions = {}
): ReminderScheduleRecord {
  const normalized = normalizeReminderSchedule(schedule);
  const errors: string[] = [];
  const { scheduleType, reminderOffsetUnit } = normalized;

  if (!REMINDER_SCHEDULE_TYPES.includes(scheduleType)) {
    errors.push(`Unsupported scheduleType: ${scheduleType}`);
  }

  if (!REMINDER_OFFSET_UNITS.includes(reminderOffsetUnit)) {
    errors.push(`Unsupported reminderOffsetUnit: ${reminderOffsetUnit}`);
  }

  if (
    !normalized.reminderDate ||
    Number.isNaN(new Date(normalized.reminderDate).getTime())
  ) {
    errors.push("reminderDate must be a valid date");
  }

  if (normalized.reminderTimes.length === 0) {
    errors.push("reminderTimes must include at least one HH:MM entry");
  }

  if (normalized.notificationChannels.length === 0) {
    errors.push("notificationChannels cannot be empty");
  }

  if (normalized.occurrencesSent < 0) {
    errors.push("occurrencesSent cannot be negative");
  }

  if (
    normalized.occurrencesRemaining !== null &&
    normalized.occurrencesRemaining < 0
  ) {
    errors.push("occurrencesRemaining cannot be negative");
  }

  const hasRemaining =
    normalized.scheduleType === "infinite" ||
    (normalized.occurrencesRemaining ?? 0) > 0;
  if (!hasRemaining && normalized.isActive) {
    errors.push("isActive cannot be true when no occurrences remain");
  }

  if (scheduleType === "one_time") {
    if (normalized.totalOccurrences !== 1) {
      errors.push("one_time schedules must have totalOccurrences = 1");
    }
    if (normalized.recurrenceData) {
      errors.push("one_time schedules must not include recurrenceData");
    }
    if (normalized.reminderInterval !== null) {
      errors.push("one_time schedules must have null reminderInterval");
    }
    const sum = normalized.occurrencesSent + (normalized.occurrencesRemaining ?? 0);
    if (sum !== 1) {
      errors.push("one_time schedules must satisfy sent + remaining = 1");
    }
  }

  if (scheduleType === "finite") {
    if (
      typeof normalized.totalOccurrences !== "number" ||
      normalized.totalOccurrences < 1
    ) {
      errors.push("finite schedules require totalOccurrences >= 1");
    }
    if (typeof normalized.occurrencesRemaining !== "number") {
      errors.push("finite schedules require numeric occurrencesRemaining");
    } else {
      const sum = normalized.occurrencesSent + normalized.occurrencesRemaining;
      if (sum !== normalized.totalOccurrences) {
        errors.push("finite schedules must satisfy sent + remaining = totalOccurrences");
      }
    }
    if (!normalized.recurrenceData) {
      errors.push("finite schedules must include recurrenceData");
    } else {
      if (normalized.recurrenceData.endType !== "after") {
        errors.push("finite schedules require recurrenceData.endType = 'after'");
      }
      if (
        typeof normalized.recurrenceData.endCount !== "number" ||
        normalized.recurrenceData.endCount !== normalized.totalOccurrences
      ) {
        errors.push("recurrenceData.endCount must equal totalOccurrences");
      }
    }
  }

  if (scheduleType === "infinite") {
    if (normalized.totalOccurrences !== null) {
      errors.push("infinite schedules must have totalOccurrences = null");
    }
    if (normalized.occurrencesRemaining !== null) {
      errors.push("infinite schedules must have occurrencesRemaining = null");
    }
    if (!normalized.recurrenceData || normalized.recurrenceData.endType !== "never") {
      errors.push("infinite schedules require recurrenceData with endType = 'never'");
    }
  }

  if (errors.length > 0) {
    throw new ReminderScheduleInvariantError(
      errors,
      normalized.id,
      options.context
    );
  }

  return normalized;
}

export function calculateNextReminderDate(
  currentDate: Date | string,
  interval: string | null,
  recurrenceData?: RecurrenceData | null
): Date {
  const normalizedRecurrence = recurrenceData ? normalizeRecurrenceTokens(recurrenceData) : null;
  const normalizedInterval = (interval || normalizedRecurrence?.pattern || "daily").toLowerCase();
  const step = Math.max(1, normalizedRecurrence?.interval || 1);
  const baseDate = new Date(currentDate);

  if (normalizedRecurrence?.pattern) {
    try {
      return getNextOccurrence(
        baseDate,
        {
          ...normalizedRecurrence,
          interval: step,
          pattern: normalizedRecurrence.pattern,
        } as any
      );
    } catch (error) {
      console.warn(
        "⚠️  Failed to use recurrence calculator, falling back to interval math:",
        error
      );
    }
  }

  switch (normalizedInterval) {
    case "minutely":
      baseDate.setMinutes(baseDate.getMinutes() + step);
      break;
    case "hourly":
      baseDate.setHours(baseDate.getHours() + step);
      break;
    case "daily":
      baseDate.setDate(baseDate.getDate() + step);
      break;
    case "weekly":
      baseDate.setDate(baseDate.getDate() + 7 * step);
      break;
    case "monthly":
      baseDate.setMonth(baseDate.getMonth() + step);
      break;
    case "quarterly":
      baseDate.setMonth(baseDate.getMonth() + 3 * step);
      break;
    case "half-yearly":
    case "halfyearly":
      baseDate.setMonth(baseDate.getMonth() + 6 * step);
      break;
    case "yearly":
      baseDate.setFullYear(baseDate.getFullYear() + step);
      break;
    default:
      baseDate.setDate(baseDate.getDate() + step);
  }

  return baseDate;
}

export interface ScheduleSendComputationResult {
  updates: Partial<ReminderScheduleRecord>;
  nextState: ReminderScheduleRecord;
}

export function computeScheduleAfterSuccessfulSend(
  scheduleInput: ReminderSchedule | ReminderScheduleRecord,
  options: { attemptTime?: Date } = {}
): ScheduleSendComputationResult {
  const schedule = validateReminderScheduleInvariants(scheduleInput, {
    context: "post-send-pre",
  });

  const attemptTime = options.attemptTime ?? new Date();

  const updates: Partial<ReminderScheduleRecord> = {
    lastSentAt: attemptTime,
  };

  const nextState: ReminderScheduleRecord = {
    ...schedule,
    lastSentAt: attemptTime,
  };

  const sentCount = schedule.occurrencesSent + 1;
  updates.occurrencesSent = sentCount;
  nextState.occurrencesSent = sentCount;

  if (schedule.scheduleType === "one_time") {
    updates.status = "completed";
    updates.isActive = false;
    updates.occurrencesRemaining = 0;
    nextState.status = "completed";
    nextState.isActive = false;
    nextState.occurrencesRemaining = 0;
  } else if (schedule.scheduleType === "finite") {
    const remainingBefore = schedule.occurrencesRemaining ?? 0;
    const remaining = Math.max(0, remainingBefore - 1);
    updates.occurrencesRemaining = remaining;
    nextState.occurrencesRemaining = remaining;

    if (remaining === 0 || sentCount >= (schedule.totalOccurrences ?? sentCount)) {
      updates.status = "completed";
      updates.isActive = false;
      nextState.status = "completed";
      nextState.isActive = false;
    } else {
      const nextReminderDate = calculateNextReminderDate(
        schedule.reminderDate,
        schedule.reminderInterval,
        schedule.recurrenceData
      );
      
      // ⭐ Enforce endDate for finite schedules
      if (schedule.endDate && nextReminderDate > schedule.endDate) {
        console.log(`   ⚠️  Next reminder ${nextReminderDate.toISOString()} exceeds endDate ${schedule.endDate.toISOString()} - marking completed`);
        updates.status = "completed";
        updates.isActive = false;
        updates.occurrencesRemaining = 0;
        nextState.status = "completed";
        nextState.isActive = false;
        nextState.occurrencesRemaining = 0;
      } else {
        updates.reminderDate = nextReminderDate;
        updates.status = "pending";
        updates.isActive = true;
        nextState.reminderDate = nextReminderDate;
        nextState.status = "pending";
        nextState.isActive = true;
      }
    }
  } else {
    // infinite schedule
    const nextReminderDate = calculateNextReminderDate(
      schedule.reminderDate,
      schedule.reminderInterval,
      schedule.recurrenceData
    );
    
    // ⭐ Enforce endDate for infinite schedules
    if (schedule.endDate && nextReminderDate > schedule.endDate) {
      console.log(`   ⚠️  Next reminder ${nextReminderDate.toISOString()} exceeds endDate ${schedule.endDate.toISOString()} - marking completed`);
      updates.status = "completed";
      updates.isActive = false;
      nextState.status = "completed";
      nextState.isActive = false;
    } else {
      updates.reminderDate = nextReminderDate;
      updates.status = "pending";
      updates.isActive = true;
      nextState.reminderDate = nextReminderDate;
      nextState.status = "pending";
      nextState.isActive = true;
    }
  }

  validateReminderScheduleInvariants(nextState, {
    context: "post-send-next",
  });

  return { updates, nextState };
}

