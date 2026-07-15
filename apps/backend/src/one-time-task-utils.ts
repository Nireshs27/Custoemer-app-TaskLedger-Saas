import type { InsertVehicleItem } from "@shared/schema";

const ONE_TIME_ALLOWED_FIELDS = new Set([
  "title",
  "category",
  "description",
  "dueDate",
  "reminderOffsetValue",
  "reminderOffsetUnit",
  "reminderTimes",
  "notificationChannels",
  "emailRecipients",
  "whatsappRecipients",
  "smsRecipients",
  "reminderDays",
]);

const SOFT_FIELDS = new Set(["title", "category", "description"]);

const STRUCTURAL_FIELDS = new Set([
  "dueDate",
  "reminderOffsetValue",
  "reminderOffsetUnit",
  "reminderTimes",
  "notificationChannels",
  "emailRecipients",
  "whatsappRecipients",
  "smsRecipients",
  "reminderDays",
]);

export interface OneTimeEditContext {
  reminderSent: boolean;
  isCompleted: boolean;
}

export interface FilterOneTimeUpdatesResult {
  allowedUpdates: Partial<InsertVehicleItem>;
  hasStructuralUpdates: boolean;
  hasSoftUpdates: boolean;
}

export function filterOneTimeTaskUpdates(
  updates: Partial<InsertVehicleItem>,
  context: OneTimeEditContext
): FilterOneTimeUpdatesResult {
  if (context.isCompleted) {
    return {
      allowedUpdates: {},
      hasStructuralUpdates: false,
      hasSoftUpdates: false,
    };
  }

  const allowedUpdates: Partial<InsertVehicleItem> = {};
  let hasStructuralUpdates = false;
  let hasSoftUpdates = false;

  Object.entries(updates).forEach(([key, value]) => {
    if (!ONE_TIME_ALLOWED_FIELDS.has(key)) {
      return;
    }
    const isStructural = STRUCTURAL_FIELDS.has(key);
    if (context.reminderSent && isStructural) {
      return;
    }
    (allowedUpdates as Record<string, any>)[key] = value;
    if (isStructural) {
      hasStructuralUpdates = true;
    } else if (SOFT_FIELDS.has(key)) {
      hasSoftUpdates = true;
    }
  });

  return { allowedUpdates, hasStructuralUpdates, hasSoftUpdates };
}

