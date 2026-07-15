export function pickFirst<T>(...vals: (T | undefined | null)[]): T | undefined | null {
  for (const v of vals) {
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Convert value to JSON text array (for DB storage)
 * Vehicles pattern: arrays are stored as JSON strings in DB
 */
export function toJsonTextArray(v: any, fallback: string[] = []): string {
  if (v === undefined || v === null) return JSON.stringify(fallback);
  if (typeof v === "string") return v; // already JSON text
  if (Array.isArray(v)) return JSON.stringify(v);
  return JSON.stringify(fallback);
}

/**
 * Convert value to JSON text object (for DB storage)
 */
export function toJsonTextObject(v: any): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v; // already JSON text
  if (typeof v === "object") return JSON.stringify(v);
  return null;
}

/**
 * Coerce asset item payload for DB insertion (vehicles-style)
 * Converts arrays to JSON strings before insert
 */
export function coerceAssetItemForDb(body: any) {
  return {
    ...body,
    notificationChannels: toJsonTextArray(body.notificationChannels ?? body.notification_channels, ["email"]),
    emailRecipients: toJsonTextArray(body.emailRecipients ?? body.email_recipients, []),
    whatsappRecipients: toJsonTextArray(body.whatsappRecipients ?? body.whatsapp_recipients, []),
    reminderTimes: toJsonTextArray(body.reminderTimes ?? body.reminder_times, ["09:00"]),
    recurrenceData: toJsonTextObject(body.recurrenceData ?? body.recurrence_data),
  };
}

/**
 * Normalize incoming payloads to canonical keys.
 * map: canonicalKey -> list of alias keys to try (typically snake_case).
 */
export function normalizeByMap(
  body: any,
  map: Record<string, string[]>,
  options: { mode?: "create" | "patch" } = {}
): Record<string, any> {
  const mode = options.mode ?? "create";
  const out: Record<string, any> = { ...body };
  for (const canonicalKey of Object.keys(map)) {
    const aliases = map[canonicalKey] || [];
    const val = pickFirst(body?.[canonicalKey], ...aliases.map((k) => body?.[k]));
    if (val !== undefined) {
      out[canonicalKey] = val;
    } else if (mode === "create") {
      // For create, default missing to null; for patch we leave undefined
      out[canonicalKey] = null;
    }
  }
  return out;
}

/**
 * Normalize asset item payload (for task creation/updates)
 * Maps snake_case input to camelCase canonical keys
 */
export function normalizeAssetItemPayload(
  body: any,
  options: { mode?: "create" | "patch" } = {}
): Record<string, any> {
  return normalizeByMap(
    body,
    {
      title: ["task_title"],
      dueDate: ["due_date"],
      isRecurring: ["is_recurring"],
      notificationChannels: ["notification_channels"],
      emailRecipients: ["email_recipients"],
      whatsappRecipients: ["whatsapp_recipients"],
      smsRecipients: ["sms_recipients"],
      reminderTimes: ["reminder_times"],
      reminderOffsetValue: ["reminder_offset_value"],
      reminderOffsetUnit: ["reminder_offset_unit"],
      reminderDays: ["reminder_days"],
      recurrenceData: ["recurrence_data"],
      recurrenceInterval: ["recurrence_interval"],
      recurrencePattern: ["recurrence_pattern"],
      recurrenceEndDate: ["recurrence_end_date"],
      nextDueDate: ["next_due_date"],
      description: [],
      amount: [],
      status: [],
      notes: [],
      customFields: ["custom_fields"],
    },
    options
  );
}

