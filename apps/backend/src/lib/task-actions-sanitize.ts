import type { InsertTaskAction } from "@shared/schema";

const REMINDER_KEYS = [
  "isRecurring",
  "recurrenceData",
  "recurrencePattern",
  "recurrenceInterval",
  "recurrenceEndDate",
  "nextDueDate",
  "reminderDays",
  "reminderOffsetValue",
  "reminderOffsetUnit",
  "customReminderDates",
  "reminderTimes",
  "notificationChannels",
  "emailRecipients",
  "whatsappRecipients",
  "smsRecipients",
] as const;

const ALLOWED_KEYS: Array<keyof InsertTaskAction> = [
  "title",
  "description",
  "category",
  "priority",
  "status",
  "assignees",
  "taskPoints",
  "createdBy",
  // ⚠️ REMOVED: dueDate/dueTime - Task Actions don't have parent due dates
  // Use task_action_items.due_date instead
];

export function sanitizeTaskActionPayload(input: any): Partial<InsertTaskAction> {
  const sanitized: Record<string, unknown> = {};

  for (const key of ALLOWED_KEYS) {
    if (key in input) {
      sanitized[key] = input[key];
    }
  }

  // Drop all reminder/recurrence fields explicitly
  REMINDER_KEYS.forEach((key) => {
    if (key in sanitized) {
      delete sanitized[key];
    }
    if (key in input) {
      // Ignore silently; optionally could log debug
    }
  });

  return sanitized as Partial<InsertTaskAction>;
}

