import type { RecurrenceData } from "./recurrence-validation";

export interface ReminderSchedule {
  id: string;
  scheduleType: string;
  status: string;
  reminderOffsetUnit: string;
  recurrenceData: unknown;
  recipientEmail: unknown;
  recipientPhone: unknown;
  notificationChannels: unknown;
  reminderTimes: unknown;
  [key: string]: unknown;
}

export const REMINDER_OFFSET_UNITS = ["minutes", "hours", "days"] as const;
export type ReminderOffsetUnit = (typeof REMINDER_OFFSET_UNITS)[number];

export const REMINDER_CHANNELS = ["email", "whatsapp", "sms"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const REMINDER_SCHEDULE_STATUSES = [
  "pending",
  "completed",
  "cancelled",
  "paused",
  "failed",
  "sent",
] as const;
export type ReminderScheduleStatus =
  (typeof REMINDER_SCHEDULE_STATUSES)[number];

export const REMINDER_SCHEDULE_TYPES = ["one_time", "finite", "infinite"] as const;
export type ReminderScheduleType = (typeof REMINDER_SCHEDULE_TYPES)[number];

export type ReminderScheduleRecord = Omit<
  ReminderSchedule,
  | "scheduleType"
  | "status"
  | "reminderOffsetUnit"
  | "recurrenceData"
  | "recipientEmail"
  | "recipientPhone"
  | "notificationChannels"
  | "reminderTimes"
> & {
  scheduleType: ReminderScheduleType;
  status: ReminderScheduleStatus;
  reminderOffsetUnit: ReminderOffsetUnit;
  recurrenceData: RecurrenceData | null;
  recipientEmail: string[];
  recipientPhone: string[];
  notificationChannels: ReminderChannel[];
  reminderTimes: string[];
};

export interface ReminderScheduleInvariantSection {
  title: string;
  rules: string[];
}

export interface ReminderScheduleInvariantDefinition {
  common: ReminderScheduleInvariantSection;
  oneTime: ReminderScheduleInvariantSection;
  finite: ReminderScheduleInvariantSection;
  infinite: ReminderScheduleInvariantSection;
}

export const REMINDER_SCHEDULE_INVARIANTS: ReminderScheduleInvariantDefinition = {
  common: {
    title: "Common",
    rules: [
      "scheduleType must be one_time, finite, or infinite",
      "status must be a recognized value (pending, completed, cancelled, paused, failed, sent)",
      "reminderDate must be a valid timestamp and represent the next send instant",
      "reminderTimes must contain at least one HH:MM entry",
      "notificationChannels must include at least one channel",
      "reminderOffsetUnit must be minutes, hours, or days",
      "occurrencesSent is >= 0",
      "occurrencesRemaining is >= 0 when defined",
      "When totalOccurrences is defined, occurrencesSent + occurrencesRemaining = totalOccurrences",
      "isActive is true only while the schedule still has occurrences to send (pending/paused)",
      "recipientEmail and recipientPhone are stored as arrays on the unified row",
    ],
  },
  oneTime: {
    title: "One-Time",
    rules: [
      "totalOccurrences is exactly 1",
      "occurrencesSent is either 0 (pending) or 1 (completed)",
      "occurrencesRemaining is 1 - occurrencesSent",
      "recurrenceData and reminderInterval are null",
      "Reminder edits cannot flip scheduleType to recurring",
    ],
  },
  finite: {
    title: "Finite Recurrence",
    rules: [
      "totalOccurrences and occurrencesRemaining are numeric",
      "totalOccurrences equals recurrenceData.endCount",
      "recurrenceData.endType is 'after' (known end count)",
      "occurrencesRemaining decrements to 0 and schedule moves to completed",
      "reminderDate always points at the next pending occurrence",
    ],
  },
  infinite: {
    title: "Infinite Recurrence",
    rules: [
      "totalOccurrences and occurrencesRemaining are null",
      "recurrenceData exists and endType is 'never'",
      "occurrencesSent increments unboundedly while reminderDate advances",
    ],
  },
};

