import {
  DEFAULT_REMINDER_OFFSET_VALUE,
  DEFAULT_REMINDER_OFFSET_UNIT,
  ReminderOffsetUnit,
  toLegacyReminderDays,
} from "./reminder-offset";

const normalizeArray = (value: any): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry) => typeof entry === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

export interface VehicleItemRecord {
  id: string;
  title?: string | null;
  category?: string | null;
  dueDate: string;
  description?: string | null;
  reminderDays?: number | null;
  reminderOffsetValue?: number | null;
  reminderOffsetUnit?: ReminderOffsetUnit | null;
  reminderTimes?: string[] | string | null;
  notificationChannels?: string[] | string | null;
  emailRecipients?: string[] | string | null;
  whatsappRecipients?: string[] | string | null;
  status?: string | null;
  isRecurring?: boolean | null;
}

export interface ReminderScheduleRecord {
  id?: string;
  scheduleType?: string | null;
  reminderOffsetValue?: number | null;
  reminderOffsetUnit?: ReminderOffsetUnit | null;
  reminderDaysBefore?: number | null;
  reminderTimes?: string[] | string | null;
  notificationChannels?: string[] | string | null;
  recipientEmail?: string[] | string | null;
  recipientPhone?: string[] | string | null;
  occurrencesSent?: number | null;
}

export interface OneTimeTaskFormValues {
  title: string;
  category: string;
  dueDate: string;
  description?: string;
  reminderOffsetValue: number;
  reminderOffsetUnit: ReminderOffsetUnit;
  reminderTimes: string[];
  notificationChannels: string[];
  emailRecipients: string[];
  reminderDays: number;
}

export interface OneTimeReminderState {
  reminderSent: boolean;
  isCompleted: boolean;
}

export interface OneTimeTaskFormMapping {
  values: OneTimeTaskFormValues;
  reminderState: OneTimeReminderState;
}

const pickOffsetValue = (
  task: VehicleItemRecord,
  reminder?: ReminderScheduleRecord | null
): { value: number; unit: ReminderOffsetUnit } => {
  const rawValue =
    (typeof reminder?.reminderOffsetValue === "number"
      ? reminder?.reminderOffsetValue
      : typeof task.reminderOffsetValue === "number"
      ? task.reminderOffsetValue
      : typeof reminder?.reminderDaysBefore === "number"
      ? reminder?.reminderDaysBefore
      : typeof task.reminderDays === "number"
      ? task.reminderDays
      : undefined) ?? DEFAULT_REMINDER_OFFSET_VALUE;

  const unit =
    (reminder?.reminderOffsetUnit as ReminderOffsetUnit | undefined) ??
    (task.reminderOffsetUnit as ReminderOffsetUnit | undefined) ??
    DEFAULT_REMINDER_OFFSET_UNIT;

  return {
    value: Math.max(1, Math.round(rawValue)),
    unit,
  };
};

const pickReminderTimes = (
  task: VehicleItemRecord,
  reminder?: ReminderScheduleRecord | null
) => {
  const scheduleTimes = normalizeArray(reminder?.reminderTimes);
  const taskTimes = normalizeArray(task.reminderTimes);
  const fallback = scheduleTimes.length > 0 ? scheduleTimes : taskTimes;
  if (fallback.length === 0) {
    return ["09:00"];
  }
  return fallback;
};

export function mapOneTimeTaskToForm(
  task: VehicleItemRecord,
  reminder?: ReminderScheduleRecord | null
): OneTimeTaskFormMapping {
  const { value: offsetValue, unit: offsetUnit } = pickOffsetValue(
    task,
    reminder
  );
  const reminderTimes = pickReminderTimes(task, reminder);
  const notificationChannels =
    normalizeArray(reminder?.notificationChannels).length > 0
      ? normalizeArray(reminder?.notificationChannels)
      : normalizeArray(task.notificationChannels).length > 0
      ? normalizeArray(task.notificationChannels)
      : ["email"];
  const emailRecipients =
    normalizeArray(reminder?.recipientEmail).length > 0
      ? normalizeArray(reminder?.recipientEmail)
      : normalizeArray(task.emailRecipients);

  const values: OneTimeTaskFormValues = {
    title: task.title || "",
    category: task.category || "Other",
    dueDate: task.dueDate,
    description: task.description || "",
    reminderOffsetValue: offsetValue,
    reminderOffsetUnit: offsetUnit,
    reminderTimes,
    notificationChannels,
    emailRecipients,
    reminderDays: toLegacyReminderDays(offsetValue, offsetUnit),
  };

  const reminderState: OneTimeReminderState = {
    reminderSent: (reminder?.occurrencesSent ?? 0) > 0,
    isCompleted: (task.status || "").toLowerCase() === "completed",
  };

  return { values, reminderState };
}

