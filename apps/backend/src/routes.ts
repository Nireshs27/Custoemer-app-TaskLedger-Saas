import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { z } from "zod";
import {
  storage,
  DEFAULT_REMINDER_OFFSET_VALUE,
  normalizeReminderOffset,
} from "./storage";
import { setupAuth, requireAuth, requireAdmin } from "./auth";
import { normalizeByMap, normalizeAssetItemPayload, coerceAssetItemForDb } from "./lib/normalize-input";
import { ObjectStorageService, ObjectNotFoundError, buildTaskLedgerObjectKey, getTaskLedgerBucket } from "./objectStorage";
import { isDueTodayOrPastIST, formatDueDateForError } from "./lib/date-guards";
import { emailService } from "./emailService";
import { emailTransport } from "./lib/email-transport";
import {
  insertPropertySchema,
  insertTaxLegalComplianceSchema,
  insertTaxLegalItemSchema,
  insertVehicleSchema,
  insertVehicleItemSchema,
  updateVehicleItemSchema,
  insertAssetSchema,
  insertAssetItemSchema,
  updateAssetItemSchema,
  insertTaskActionItemSchema,
  updateTaskActionItemSchema,
  insertTaskActionSchema,
  insertCalendarEventSchema,
  vehicleItems,
  assetItems,
  taskActionItems,
  taxLegalItems,
  type InsertVehicleItem,
} from "@shared/schema";
import { isUuid } from "./lib/uuid";
import { and, eq, sql } from "drizzle-orm";
import {
  getTodayYmdIST,
  parseMonthParam,
  monthToRange,
  kindToEntityTypes,
  mapDbEntityToUi,
} from "./lib/task-filters";

import {
  getNextOccurrence,
  doesDateMatchRecurrence,
} from "@shared/recurrence-calculator";
// import { taskOccurrenceRouter } from "./routes/task-occurrence";  // ⚠️ File is empty, commented out
import { taskOccurrenceStatusesRouter } from "./routes/task-occurrence-statuses";
import categoriesRouter from "./routes/categories";
import { filterOneTimeTaskUpdates } from "./one-time-task-utils";
import { parseCalendarRange } from "./lib/calendar-range";
import {
  SYSTEM_FALLBACK_RECIPIENT,
} from "./reminderConstants";
// Legacy imports no longer used with occurrence_reminders system
// import { attemptReminderSend, buildScheduleContext } from "./reminder-sender";
import { recurrenceDataSchema } from "@shared/recurrence-validation";
import { sanitizeTaskActionPayload } from "./lib/task-actions-sanitize";

type RecurrenceData = z.infer<typeof recurrenceDataSchema>;

/**
 * Parse and validate DB occurrence key format: <uuid>::<ISO_Z>
 * Rejects legacy/prefixed formats like "entityType:<uuid>::<iso>"
 * 
 * Returns null if:
 * - Key doesn't contain "::"
 * - Key contains ":" before "::" (legacy prefix format)
 * - entityId part is not a valid UUID
 * - ISO part is not a valid date
 * - ISO doesn't end with "Z" (enforces UTC)
 * 
 * This ensures client code can never send wrong format and get confusing 404.
 * Bad format → 400 (immediate rejection with clear message)
 * Good format but no DB row → 404 (legitimate "not found")
 */
function parseDbOccurrenceKey(key: string): { entityId: string; iso: string } | null {
  const trimmed = key.trim();

  // Reject legacy/prefixed formats early (e.g. "tax_legal_item:<uuid>::...")
  const idx = trimmed.indexOf("::");
  if (idx <= 0) return null;

  // If there is a ":" before the "::", it's NOT the DB format
  const before = trimmed.slice(0, idx);
  if (before.includes(":")) return null;

  const entityId = before;
  const iso = trimmed.slice(idx + 2);

  if (!isUuid(entityId)) return null;

  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;

  // Enforce UTC Z to avoid timezone variants creeping in
  if (!iso.endsWith("Z")) return null;

  return { entityId, iso };
}

// Helper functions for entity ownership verification
// OPTIMIZED: Uses storage methods that check ownership directly (1 query instead of 2)
export async function verifyEntityOwnership(
  entityType: string,
  entityId: string,
  userId: string,
  storageClient = storage
): Promise<boolean> {
  try {
    switch (entityType) {
      case 'tax_legal_compliance':
        const compliance = await (storageClient as any).getTaxLegalCompliance(entityId);
        return compliance?.createdBy === userId;
      case 'tax_legal_item':
        const item = await (storageClient as any).getTaxLegalItem(entityId);
        if (!item) return false;
        const parent = await (storageClient as any).getTaxLegalCompliance(item.complianceId);
        return parent?.createdBy === userId;
      case 'vehicle_item':
        // OPTIMIZED: Check vehicle_item ownership via vehicle in single query
        const vehicleItem = await storageClient.getVehicleItem(entityId);
        if (!vehicleItem) return false;
        const vehicle = await storageClient.getVehicle(vehicleItem.vehicleId);
        return vehicle?.createdBy === userId;
      case 'asset_item':
        // OPTIMIZED: Check asset_item ownership via asset in single query
        const assetItem = await storageClient.getAssetItem(entityId);
        if (!assetItem) return false;
        const asset = await storageClient.getAsset(assetItem.assetId);
        return asset?.createdBy === userId;
      case 'task_action':
        const taskAction = await storageClient.getTaskAction(entityId);
        return taskAction?.createdBy === userId;
    case 'task_action_item':
      const taskActionItem = await storageClient.getTaskActionItem(entityId);
      if (!taskActionItem) return false;
      const parentTaskAction = await storageClient.getTaskAction(taskActionItem.taskActionId);
      return parentTaskAction?.createdBy === userId;
      case 'calendar_event':
        const calendarEvent = await storageClient.getCalendarEvent(entityId);
        return calendarEvent?.createdBy === userId;
      default:
        return false;
    }
  } catch (error) {
    console.error('Error verifying entity ownership:', error);
    return false;
  }
}

const parseJsonArray = (value: any): string[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * Shared helper to create/update reminders for an asset item
 * Used by both POST (create) and PUT (update) routes
 */
async function upsertRemindersForAssetItem(
  userId: string,
  item: { id: string; title: string; category: string | null; dueDate: string | Date; nextDueDate?: string | Date | null; isRecurring: boolean | null; recurrenceData: any; reminderOffsetValue: number | null; reminderOffsetUnit: string | null; reminderDays: number | null; notificationChannels: any; emailRecipients: any; whatsappRecipients: any; reminderTimes: any }
) {
  const reminderDaysValue =
    typeof item.reminderDays === "number" ? item.reminderDays : DEFAULT_REMINDER_OFFSET_VALUE;
  const reminderOffsetValue =
    typeof item.reminderOffsetValue === "number" ? item.reminderOffsetValue : reminderDaysValue || 0;
  const reminderOffsetUnit =
    typeof item.reminderOffsetUnit === "string" ? item.reminderOffsetUnit : "days";

  const notificationChannels = parseJsonArray(item.notificationChannels);
  const emailRecipients = parseJsonArray(item.emailRecipients);
  const whatsappRecipients = parseJsonArray(item.whatsappRecipients);
  const reminderTimes = parseJsonArray(item.reminderTimes);

  const parsedRecurrenceData = recurrenceDataSchema.safeParse(item.recurrenceData);
  const recurrenceData = parsedRecurrenceData.success ? parsedRecurrenceData.data : null;

  const offset = normalizeReminderOffset(
    reminderOffsetValue,
    reminderOffsetUnit,
    reminderDaysValue
  );

  if (offset.value <= 0) {
    if (process.env.NODE_ENV === "test") {
      console.log("[upsertRemindersForAssetItem] Skipping reminder creation - offset.value <= 0");
    }
    return;
  }

  const dueDateStr = item.dueDate instanceof Date
    ? item.dueDate.toISOString().split('T')[0]
    : item.dueDate;
  const nextDueDateStr = item.nextDueDate
    ? (item.nextDueDate instanceof Date
      ? item.nextDueDate.toISOString().split('T')[0]
      : item.nextDueDate)
    : null;

  await storage.materializeOccurrenceRemindersForEntity({
    userId,
    entityType: "asset_item",
    entityId: item.id,
    taskTitle: item.title,
    isRecurring: !!item.isRecurring,
    dueDateYmd: dueDateStr,
    nextDueDateYmd: nextDueDateStr,
    recurrenceData,
    reminderOffsetValue: offset.value,
    reminderOffsetUnit: offset.unit,
    notificationChannels: notificationChannels.length > 0 ? notificationChannels : ["email"],
    emailRecipients,
    whatsappRecipients,
    smsRecipients: [],
    reminderTimes: reminderTimes.length > 0 ? reminderTimes : ["09:00"]
  });
}

/**
 * Shared helper to create/update reminders for a task action item
 */
async function upsertRemindersForTaskActionItem(
  userId: string,
  item: {
    id: string;
    title: string;
    dueDate: string | Date;
    nextDueDate?: string | Date | null;
    isRecurring: boolean | null;
    recurrenceData: any;
    reminderOffsetValue: number | null;
    reminderOffsetUnit: string | null;
    reminderDays: number | null;
    notificationChannels: any;
    emailRecipients: any;
    whatsappRecipients: any;
    reminderTimes: any;
  }
) {
  const reminderDaysValue =
    typeof item.reminderDays === "number"
      ? item.reminderDays
      : DEFAULT_REMINDER_OFFSET_VALUE;
  const reminderOffsetValue =
    typeof item.reminderOffsetValue === "number"
      ? item.reminderOffsetValue
      : reminderDaysValue || 0;
  const reminderOffsetUnit =
    typeof item.reminderOffsetUnit === "string"
      ? item.reminderOffsetUnit
      : "days";

  const notificationChannels = parseJsonArray(item.notificationChannels);
  const emailRecipients = parseJsonArray(item.emailRecipients);
  const whatsappRecipients = parseJsonArray(item.whatsappRecipients);
  const reminderTimes = parseJsonArray(item.reminderTimes);

  const parsedRecurrenceData = recurrenceDataSchema.safeParse(item.recurrenceData);
  const recurrenceData = parsedRecurrenceData.success ? parsedRecurrenceData.data : null;

  const offset = normalizeReminderOffset(
    reminderOffsetValue,
    reminderOffsetUnit,
    reminderDaysValue
  );

  if (offset.value <= 0) {
    if (process.env.NODE_ENV === "test") {
      console.log("[upsertRemindersForTaskActionItem] Skipping reminder creation - offset.value <= 0");
    }
    return;
  }

  const dueDateStr =
    item.dueDate instanceof Date
      ? item.dueDate.toISOString().split("T")[0]
      : item.dueDate;
  const nextDueDateStr = item.nextDueDate
    ? (item.nextDueDate instanceof Date
      ? item.nextDueDate.toISOString().split('T')[0]
      : item.nextDueDate)
    : null;

  await storage.materializeOccurrenceRemindersForEntity({
    userId,
    entityType: "task_action_item",
    entityId: item.id,
    taskTitle: item.title,
    isRecurring: !!item.isRecurring,
    dueDateYmd: dueDateStr,
    nextDueDateYmd: nextDueDateStr,
    recurrenceData,
    reminderOffsetValue: offset.value,
    reminderOffsetUnit: offset.unit,
    notificationChannels: notificationChannels.length > 0 ? notificationChannels : ["email"],
    emailRecipients,
    whatsappRecipients,
    smsRecipients: [],
    reminderTimes: reminderTimes.length > 0 ? reminderTimes : ["09:00"]
  });
}

/**
 * Shared helper to create/update reminders for a tax_legal_item.
 * IMPORTANT: tax_legal_items do NOT store reminder config; the config comes from request payload.
 */
async function upsertRemindersForTaxLegalItem(
  userId: string,
  input: {
    id: string;
    title: string;
    dueDate: string | Date;
    nextDueDate?: string | Date | null;
    isRecurring: boolean | null;
    recurrenceData: any;
    reminderOffsetValue: number | null;
    reminderOffsetUnit: string | null;
    notificationChannels: any;
    emailRecipients: any;
    whatsappRecipients: any;
    reminderTimes: any;
  }
) {
  const reminderOffsetValue =
    typeof input.reminderOffsetValue === "number"
      ? input.reminderOffsetValue
      : DEFAULT_REMINDER_OFFSET_VALUE;
  const reminderOffsetUnit =
    typeof input.reminderOffsetUnit === "string" ? input.reminderOffsetUnit : "days";

  const notificationChannels = parseJsonArray(input.notificationChannels);
  const emailRecipients = parseJsonArray(input.emailRecipients);
  const whatsappRecipients = parseJsonArray(input.whatsappRecipients);
  const reminderTimes = parseJsonArray(input.reminderTimes);

  // recurrenceData may come back from DB as a JSON string; parse it before zod.
  const rawRecurrence = input.recurrenceData;
  const maybeRecurrenceObj =
    typeof rawRecurrence === "string"
      ? (() => {
          try {
            return JSON.parse(rawRecurrence);
          } catch {
            return rawRecurrence;
          }
        })()
      : rawRecurrence;

  const parsedRecurrenceData = recurrenceDataSchema.safeParse(maybeRecurrenceObj);
  const recurrenceData = parsedRecurrenceData.success ? parsedRecurrenceData.data : null;
  if (input.isRecurring && !recurrenceData) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[upsertRemindersForTaxLegalItem] invalid recurrenceData for recurring item entityType=tax_legal_item itemId=${input.id}`
      );
    }
    throw new Error("isRecurring=true but recurrenceData is missing/invalid");
  }

  const offset = normalizeReminderOffset(
    reminderOffsetValue,
    reminderOffsetUnit,
    DEFAULT_REMINDER_OFFSET_VALUE
  );

  if (offset.value <= 0) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[upsertRemindersForTaxLegalItem] skip offset<=0 entityType=tax_legal_item itemId=${input.id} offset=${offset.value} ${offset.unit}`
      );
    }
    return;
  }

  const dueDateStr =
    input.dueDate instanceof Date ? input.dueDate.toISOString().split("T")[0] : input.dueDate;
  const nextDueDateStr = input.nextDueDate
    ? (input.nextDueDate instanceof Date
      ? input.nextDueDate.toISOString().split('T')[0]
      : input.nextDueDate)
    : null;

  await storage.materializeOccurrenceRemindersForEntity({
    userId,
    entityType: "tax_legal_item",
    entityId: input.id,
    taskTitle: input.title,
    isRecurring: !!input.isRecurring,
    dueDateYmd: dueDateStr,
    nextDueDateYmd: nextDueDateStr,
    recurrenceData,
    reminderOffsetValue: offset.value,
    reminderOffsetUnit: offset.unit,
    notificationChannels: notificationChannels.length > 0 ? notificationChannels : ["email"],
    emailRecipients,
    whatsappRecipients,
    smsRecipients: [],
    reminderTimes: reminderTimes.length > 0 ? reminderTimes : ["09:00"]
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Setup authentication
  setupAuth(app);

  // Categories routes
  app.use("/api/categories", categoriesRouter);

  // Task occurrence routes
  // app.use("/api/task-occurrence", taskOccurrenceRouter);  // ⚠️ Commented out (empty file)
  app.use("/api/task-occurrence", taskOccurrenceStatusesRouter);

  // Server location check endpoint
  app.post("/api/recurrence/preview", requireAuth, async (req, res) => {
    try {
      const { startDate, occurrenceTime, recurrenceData, count } = req.body || {};

      if (!startDate || !recurrenceData) {
        return res.status(400).json({ message: "startDate and recurrenceData are required" });
      }

      const parsedDate = new Date(startDate);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Invalid startDate" });
      }

      const timeMatch =
        typeof occurrenceTime === "string" && /^(\d{1,2}):(\d{2})$/.exec(occurrenceTime);
      if (timeMatch) {
        const hours = Number(timeMatch[1]);
        const minutes = Number(timeMatch[2]);
        parsedDate.setHours(hours, minutes, 0, 0);
      } else if (typeof startDate === "string" && !startDate.includes("T")) {
        // Apply default 9 AM when no time component is provided
        parsedDate.setHours(9, 0, 0, 0);
      }

      const safeCount = Math.min(Math.max(Number(count) || 10, 1), 50);
      const normalizedRecurrence = {
        ...recurrenceData,
        endType: recurrenceData.endType || "never",
      };

      const hardLimit =
        normalizedRecurrence.endType === "after" && normalizedRecurrence.endCount
          ? Math.min(normalizedRecurrence.endCount, safeCount)
          : safeCount;

      const endDateLimit =
        normalizedRecurrence.endType === "on" || normalizedRecurrence.endType === "onDate"
          ? normalizedRecurrence.endDate
            ? new Date(normalizedRecurrence.endDate)
            : null
          : null;

      const occurrences: string[] = [];
      let pointer = new Date(parsedDate);
      let remaining = hardLimit;

      if (doesDateMatchRecurrence(pointer, normalizedRecurrence)) {
        if (!endDateLimit || pointer <= endDateLimit) {
          occurrences.push(pointer.toISOString());
          remaining -= 1;
        }
      }

      for (let i = 0; i < remaining; i++) {
        const next = getNextOccurrence(pointer, normalizedRecurrence);
        if (!next) {
          break;
        }

        if (endDateLimit && next > endDateLimit) {
          break;
        }

        occurrences.push(next.toISOString());
        pointer = next;

        if (
          normalizedRecurrence.endType === "after" &&
          normalizedRecurrence.endCount &&
          occurrences.length >= normalizedRecurrence.endCount
        ) {
          break;
        }
      }

      res.json({ occurrences });
    } catch (error) {
      console.error("Failed to generate recurrence preview:", error);
      res.status(500).json({ message: "Failed to generate recurrence preview" });
    }
  });

  // Get missed reminder deliveries for current user (from occurrence_reminders)
  app.get("/api/reminders/missed", requireAuth, async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const missedReminders = await storage.getOpenMissedRemindersForUser(userId);
      res.json({ missedReminders });
    } catch (error) {
      console.error("Failed to fetch missed reminders", error);
      next(error);
    }
  });

  // ⭐ NEW: Mark occurrence reminder recipients as expired (mark as read)
  app.post(
    "/api/reminders/occurrence/:id/mark-expired",
    requireAuth,
    async (req, res, next) => {
      try {
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        
        const { id } = req.params;
        const { recipientKeys } = req.body ?? {};
        
        if (!id) {
          return res.status(400).json({ message: "Missing occurrence reminder ID" });
        }

        const result = await storage.markOccurrenceReminderRecipientsExpired({
          userId,
          occurrenceReminderId: id,
          recipientKeys: recipientKeys || undefined,
        });

        return res.json({ 
          ok: true, 
          updatedRecipients: result.updatedRecipients 
        });
      } catch (error) {
        console.error("Failed to mark occurrence reminder as expired", error);
        next(error);
      }
    }
  );

  // Object Storage service (used by document routes)
  const objectStorageService = new ObjectStorageService();

  // Properties API
  app.get("/api/properties", requireAuth, async (req, res, next) => {
    try {
      const properties = await storage.getPropertiesByUser(req.user!.id);
      res.json(properties);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/properties", requireAuth, async (req, res, next) => {
    try {
      const validatedData = insertPropertySchema.parse({
        ...req.body,
        createdBy: req.user!.id,
      });
      const property = await storage.createProperty(validatedData);
      res.status(201).json(property);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.put("/api/properties/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const property = await storage.updateProperty(req.user!.id, id, req.body);
      res.json(property);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/properties/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      await storage.deleteProperty(req.user!.id, id);
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  // Tax & Legal Compliance API (NEW MODULE)
  app.get("/api/tax-legal-compliances", requireAuth, async (req, res, next) => {
    try {
      const rows = await storage.listTaxLegalCompliancesByUser(req.user!.id);
      
      // ✅ Compute summaries from occurrence_reminders (single source of truth)
      // This replaces the N+1 client-side queries that were causing performance issues
      const { getOccurrenceSummariesGroupedByParent } = await import('./lib/occurrence-summary');
      const complianceIds = rows.map(c => c.id);
      const summariesMap = await getOccurrenceSummariesGroupedByParent(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          parentIds: complianceIds,
          entityType: 'tax_legal_item',
          itemsTable: taxLegalItems,
          itemIdCol: taxLegalItems.id,
          parentIdCol: taxLegalItems.complianceId,
        }
      );
      
      // Attach summaries to each compliance
      const compliancesWithSummaries = rows.map(compliance => ({
        ...compliance,
        occurrenceSummary: summariesMap.get(compliance.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(compliancesWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/tax-legal-compliances", requireAuth, async (req, res, next) => {
    try {
      const validated = insertTaxLegalComplianceSchema
        .strict()
        .parse({ ...req.body, createdBy: req.user!.id });
      const created = await storage.createTaxLegalCompliance(validated);
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.put("/api/tax-legal-compliances/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await storage.getTaxLegalCompliance(id);
      if (!existing) {
        return res.status(404).json({ message: "Compliance not found" });
      }
      if (existing.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const validated = insertTaxLegalComplianceSchema
        .partial()
        .strict()
        .omit({ createdBy: true })
        .parse(req.body);

      const updated = await storage.updateTaxLegalCompliance(id, validated as any);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/tax-legal-compliances/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await storage.getTaxLegalCompliance(id);
      if (!existing) {
        return res.status(404).json({ message: "Compliance not found" });
      }
      if (existing.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ✅ CASCADE DELETE: Delete child tax_legal_items first, then the compliance
      const taxLegalItems = await storage.listTaxLegalItemsByCompliance(id);
      
      console.log(`🗑️  Deleting tax legal compliance ${id} with ${taxLegalItems.length} child item(s)`);
      
      // Delete each child tax_legal_item
      for (const item of taxLegalItems) {
        // Tax legal items ownership is checked via parent compliance
        await storage.deleteOccurrenceRemindersForEntity({
          userId: req.user!.id,
          entityType: 'tax_legal_item',
          entityId: item.id,
        });
        await storage.deleteTaxLegalItem(item.id);
        console.log(`   ✅ Deleted child tax_legal_item: ${item.id}`);
      }
      
      // Delete the parent compliance
      await storage.deleteTaxLegalCompliance(id);
      console.log(`   ✅ Deleted parent tax legal compliance: ${id}`);
      
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  // Tax & Legal Items API (NEW MODULE)
  app.get("/api/tax-legal-compliances/:id/items", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const compliance = await storage.getTaxLegalCompliance(id);
      if (!compliance) {
        return res.status(404).json({ message: "Compliance not found" });
      }
      if (compliance.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const items = await storage.listTaxLegalItemsByCompliance(id);
      
      // Attach occurrence summaries for each item
      const { getOccurrenceSummariesForEntityIds } = await import('./lib/occurrence-summary');
      const itemIds = items.map(item => item.id);
      const summariesMap = await getOccurrenceSummariesForEntityIds(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          entityIds: itemIds,
          entityType: 'tax_legal_item',
        }
      );
      
      const itemsWithSummaries = items.map(item => ({
        ...item,
        occurrenceSummary: summariesMap.get(item.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(itemsWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  // Create item under compliance (also creates reminder schedule under entity_type='tax_legal_item')
  app.post("/api/tax-legal-compliances/:id/items", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const compliance = await storage.getTaxLegalCompliance(id);
      if (!compliance) {
        return res.status(404).json({ message: "Compliance not found" });
      }
      if (compliance.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Split strict allow-lists: item row vs reminder config
      // NOTE: We reuse the Vehicle/Asset task form, which includes fields that do NOT exist
      // on tax_legal_items (e.g. category, reminderDays). We accept them strictly here and
      // then allow-list what we persist into tax_legal_items vs occurrence_reminders.
      const requestSchema = z
        .object({
          title: z.string().min(1),
          description: z.string().optional(),
          // accepted for shared UI parity, but not stored in tax_legal_items
          category: z.string().optional().nullable(),

          dueDate: z.string().min(1),
          dueTime: z.string().optional().nullable(),
          amount: z.union([z.number(), z.string()]).optional().nullable(),
          status: z.string().optional(),

          isRecurring: z.boolean().optional(),
          recurrenceData: recurrenceDataSchema.optional().nullable(),

          // reminder config (stored in occurrence_reminders)
          reminderDays: z.number().optional(), // accepted but not stored
          reminderOffsetValue: z.number().int().min(1).optional(),
          reminderOffsetUnit: z.enum(["minutes", "hours", "days"]).optional(),
          reminderTimes: z.array(z.string()).optional(),
          notificationChannels: z.array(z.enum(["email", "whatsapp", "sms"])).optional(),
          emailRecipients: z.array(z.string()).optional(),
          whatsappRecipients: z.array(z.string()).optional(),

          // sometimes passed by update schemas elsewhere; ignore if present
          _emailRecipients: z.array(z.string()).optional(),

          // custom fields support (e.g., contacts)
          customFields: z.record(z.any()).optional(),
        })
        .strict();

      const parsed = requestSchema.parse(req.body);

      const normalizedAmount =
        typeof parsed.amount === "number"
          ? String(parsed.amount)
          : parsed.amount ?? null;

      // ✅ FIX: Tax-legal create was not persisting email_recipients; edit already did.
      const created = await storage.createTaxLegalItem({
        title: parsed.title,
        description: parsed.description ?? null,
        dueDate: parsed.dueDate,
        dueTime: parsed.dueTime ?? null,
        amount: normalizedAmount,
        status: parsed.status ?? "pending",
        isRecurring: parsed.isRecurring ?? false,
        recurrenceData: parsed.isRecurring ? parsed.recurrenceData ?? null : null,
        complianceId: id,
        createdBy: req.user!.id,
        customFields: parsed.customFields ?? null,
        emailRecipients: parsed.emailRecipients ?? [],
      });

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `[tax_legal_item] upsert reminders entityType=tax_legal_item itemId=${created.id} isRecurring=${Boolean(
            created.isRecurring
          )} offset=${parsed.reminderOffsetValue ?? DEFAULT_REMINDER_OFFSET_VALUE} ${
            parsed.reminderOffsetUnit ?? "days"
          } reminderTimes=${JSON.stringify(parsed.reminderTimes ?? ["09:00"])}`
        );
      }

      await upsertRemindersForTaxLegalItem(req.user!.id, {
        id: created.id,
        title: created.title,
        dueDate: created.dueDate,
        isRecurring: created.isRecurring,
        recurrenceData: created.recurrenceData,
        reminderOffsetValue: parsed.reminderOffsetValue ?? DEFAULT_REMINDER_OFFSET_VALUE,
        reminderOffsetUnit: parsed.reminderOffsetUnit ?? "days",
        notificationChannels: parsed.notificationChannels ?? ["email"],
        emailRecipients: parsed.emailRecipients ?? parsed._emailRecipients ?? [],
        whatsappRecipients: parsed.whatsappRecipients ?? [],
        reminderTimes: parsed.reminderTimes ?? ["09:00"],
      });

      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.put("/api/tax-legal-items/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await storage.getTaxLegalItem(id);
      if (!existing) {
        return res.status(404).json({ message: "Tax legal item not found" });
      }

      const compliance = await storage.getTaxLegalCompliance((existing as any).complianceId);
      if (!compliance || compliance.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const requestSchema = z
        .object({
          title: z.string().min(1).optional(),
          description: z.string().optional().nullable(),
          category: z.string().optional().nullable(),

          dueDate: z.string().optional(),
          dueTime: z.string().optional().nullable(),
          amount: z.union([z.number(), z.string()]).optional().nullable(),
          status: z.string().optional(),

          isRecurring: z.boolean().optional(),
          recurrenceData: recurrenceDataSchema.optional().nullable(),

          reminderDays: z.number().optional(),
          reminderOffsetValue: z.number().int().min(1).optional(),
          reminderOffsetUnit: z.enum(["minutes", "hours", "days"]).optional(),
          reminderTimes: z.array(z.string()).optional(),
          notificationChannels: z.array(z.enum(["email", "whatsapp", "sms"])).optional(),
          emailRecipients: z.array(z.string()).optional(),
          whatsappRecipients: z.array(z.string()).optional(),
          _emailRecipients: z.array(z.string()).optional(),
        })
        .strict();

      const parsed = requestSchema.parse(req.body);

      // Detect changes for selective sync
      const titleChanged = parsed.title !== undefined && parsed.title !== existing.title;
      const emailRecipientsChanged = parsed.emailRecipients !== undefined;

      const updated = await storage.updateTaxLegalItem(id, {
        title: parsed.title,
        description: parsed.description,
        dueDate: parsed.dueDate,
        dueTime: parsed.dueTime,
        amount: parsed.amount,
        status: parsed.status,
        isRecurring: parsed.isRecurring,
        recurrenceData: parsed.isRecurring ? parsed.recurrenceData : null,
        ...((parsed as any).customFields !== undefined ? { customFields: (parsed as any).customFields } : {}),
      } as any);

      // Check if structural fields changed
      const structuralFieldsChanged = 
        parsed.dueDate !== undefined ||
        parsed.isRecurring !== undefined ||
        parsed.recurrenceData !== undefined ||
        parsed.reminderOffsetValue !== undefined ||
        parsed.reminderOffsetUnit !== undefined ||
        parsed.reminderTimes !== undefined ||
        parsed.notificationChannels !== undefined;

      if (structuralFieldsChanged) {
        // Structural changes: recreate all reminders
        await upsertRemindersForTaxLegalItem(req.user!.id, {
          id: updated.id,
          title: updated.title,
          dueDate: updated.dueDate,
          isRecurring: updated.isRecurring,
          recurrenceData: updated.recurrenceData,
          reminderOffsetValue: parsed.reminderOffsetValue ?? DEFAULT_REMINDER_OFFSET_VALUE,
          reminderOffsetUnit: parsed.reminderOffsetUnit ?? "days",
          notificationChannels: parsed.notificationChannels ?? ["email"],
          emailRecipients: parsed.emailRecipients ?? parsed._emailRecipients ?? [],
          whatsappRecipients: parsed.whatsappRecipients ?? [],
          reminderTimes: parsed.reminderTimes ?? ["09:00"],
        });
      } else if (titleChanged || emailRecipientsChanged) {
        // Only title/recipients changed: sync future reminders only
        const finalEmailRecipients = parsed.emailRecipients ?? parsed._emailRecipients ?? [];
        await storage.syncFutureOccurrenceRemindersForEntity({
          userId: req.user!.id,
          entityType: "tax_legal_item",
          entityId: updated.id,
          newTitle: titleChanged ? updated.title : undefined,
          newEmailRecipients: emailRecipientsChanged ? (Array.isArray(finalEmailRecipients) ? finalEmailRecipients : []) : undefined,
        });
      }

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/tax-legal-items/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await storage.getTaxLegalItem(id);
      if (!existing) {
        return res.status(404).json({ message: "Tax legal item not found" });
      }
      const compliance = await storage.getTaxLegalCompliance((existing as any).complianceId);
      if (!compliance || compliance.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ✅ Explicit cleanup: delete occurrence_reminders for this entity
      await storage.deleteOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: 'tax_legal_item',
        entityId: id,
      });
      
      // Ensure reminders are not orphaned (defensive; storage.deleteTaxLegalItem also deletes).
      await storage.deleteOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: "tax_legal_item",
        entityId: id,
      });
      
      // Delete the parent entity (also triggers DB-level cascade, but we're explicit)
      await storage.deleteTaxLegalItem(id);
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  // ✅ METADATA-ONLY EDIT: Update tax legal item metadata via compliance route
  app.patch("/api/tax-legal-compliances/:complianceId/items/:id/metadata", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const { title, contacts, recipients } = req.body;

      // Verify ownership
      const existingItem = await storage.getTaxLegalItem(id);
      if (!existingItem) {
        return res.status(404).json({ message: "Tax legal item not found" });
      }

      const compliance = await storage.getTaxLegalCompliance((existingItem as any).complianceId);
      if (!compliance || compliance.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Update metadata
      const result = await storage.updateTaskMetadata(userId, 'tax_legal_item', id, { title, contacts, recipients });
      
      // Fetch updated task to return fresh data
      const updatedTask = await storage.getTaxLegalItem(id);
      
      // ✅ Compute editability status AFTER update
      const editabilityStatus = await storage.getTaskRecipientsEditabilityStatus(userId, 'tax_legal_item', id);
      
      res.json({ 
        message: "Metadata updated successfully",
        updatedRemindersCount: result.updatedRemindersCount,
        updatedTask: {
          id: updatedTask!.id,
          title: updatedTask!.title,
          emailRecipients: (updatedTask as any).emailRecipients,
          customFields: updatedTask!.customFields,
        },
        eligibleUpcomingUnsentCount: editabilityStatus.eligibleUpcomingUnsentCount,
        futureGenerationPossible: editabilityStatus.futureGenerationPossible,
        shouldLockEmailRecipients: editabilityStatus.shouldLockEmailRecipients,
      });
    } catch (error) {
      console.error("PATCH /api/tax-legal-compliances/:complianceId/items/:id/metadata failed", error);
      next(error);
    }
  });

  // Vehicles API
  app.get("/api/vehicles", requireAuth, async (req, res, next) => {
    try {
      const vehicles = await storage.getVehiclesByUser(req.user!.id);
      
      // ✅ Compute summaries from occurrence_reminders (single source of truth)
      const { getOccurrenceSummariesGroupedByParent } = await import('./lib/occurrence-summary');
      const vehicleIds = vehicles.map(v => v.id);
      const summariesMap = await getOccurrenceSummariesGroupedByParent(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          parentIds: vehicleIds,
          entityType: 'vehicle_item',
          itemsTable: vehicleItems,
          itemIdCol: vehicleItems.id,
          parentIdCol: vehicleItems.vehicleId,
        }
      );
      
      // Attach summaries to each vehicle
      const vehiclesWithSummaries = vehicles.map(vehicle => ({
        ...vehicle,
        occurrenceSummary: summariesMap.get(vehicle.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(vehiclesWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/vehicles", requireAuth, async (req, res, next) => {
    try {
      const validatedData = insertVehicleSchema.parse({
        ...req.body,
        createdBy: req.user!.id,
      });
      const vehicle = await storage.createVehicle(validatedData);
      res.status(201).json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.put("/api/vehicles/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      
      // Verify ownership
      const existingVehicle = await storage.getVehicle(id);
      if (!existingVehicle || existingVehicle.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Validate input
      const validatedData = insertVehicleSchema.partial().strict().omit({ createdBy: true }).parse(req.body);
      
      const vehicle = await storage.updateVehicle(id, validatedData);
      res.json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/vehicles/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      
      // Verify ownership
      const existingVehicle = await storage.getVehicle(id);
      if (!existingVehicle || existingVehicle.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ✅ CASCADE DELETE: Delete child vehicle_items first, then the vehicle
      const vehicleItems = await storage.getVehicleItemsByVehicle(id);
      
      console.log(`🗑️  Deleting vehicle ${id} with ${vehicleItems.length} child item(s)`);
      
      // Delete each child vehicle_item
      for (const item of vehicleItems) {
        if (item.createdBy === userId) {
          await storage.deleteOccurrenceRemindersForEntity({
            userId,
            entityType: 'vehicle_item',
            entityId: item.id,
          });
          await storage.deleteVehicleItem(item.id);
          console.log(`   ✅ Deleted child vehicle_item: ${item.id}`);
        }
      }
      
      // Delete the parent vehicle
      await storage.deleteVehicle(id);
      console.log(`   ✅ Deleted parent vehicle: ${id}`);
      
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  // Vehicle Items API
  app.get("/api/vehicle-items", requireAuth, async (req, res, next) => {
    try {
      const vehicleItems = await storage.getVehicleItemsByUser(req.user!.id);
      
      // Attach occurrence summaries for each item
      const { getOccurrenceSummariesForEntityIds } = await import('./lib/occurrence-summary');
      const itemIds = vehicleItems.map(item => item.id);
      const summariesMap = await getOccurrenceSummariesForEntityIds(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          entityIds: itemIds,
          entityType: 'vehicle_item',
        }
      );
      
      const itemsWithSummaries = vehicleItems.map(item => ({
        ...item,
        occurrenceSummary: summariesMap.get(item.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(itemsWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/vehicle-items/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const vehicleItem = await storage.getVehicleItem(id);
      
      if (!vehicleItem) {
        return res.status(404).json({ message: "Vehicle item not found" });
      }
      
      // Verify ownership through vehicle
      const vehicle = await storage.getVehicle(vehicleItem.vehicleId);
      if (!vehicle || vehicle.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(vehicleItem);
    } catch (error) {
      console.error("GET /api/vehicle-items/:id failed", {
        params: req.params,
        error,
        stack: (error as any)?.stack,
      });
      next(error);
    }
  });

  app.post("/api/vehicle-items", requireAuth, async (req, res, next) => {
    try {
      console.log('📝 Creating vehicle item with payload:', JSON.stringify(req.body, null, 2));
      
      // Strip category/subCategory fields (columns dropped from DB)
      const { category, subCategory, sub_category, ...cleanBody } = req.body;
      
      const validatedData = insertVehicleItemSchema.parse({
        ...cleanBody,
        createdBy: req.user!.id,
      });
      
      console.log('✅ Validation passed. Validated data:', JSON.stringify(validatedData, null, 2));
      
      // Verify that the vehicle belongs to the current user
      console.log(`🔍 Checking vehicle ownership for vehicleId: ${validatedData.vehicleId}`);
      const vehicle = await storage.getVehicle(validatedData.vehicleId);
      
      if (!vehicle) {
        console.error('❌ Vehicle not found:', validatedData.vehicleId);
        return res.status(404).json({ message: "Vehicle not found" });
      }
      
      if (vehicle.createdBy !== req.user!.id) {
        console.error('❌ Access denied. Vehicle owned by:', vehicle.createdBy, 'User:', req.user!.id);
        return res.status(403).json({ message: "Access denied" });
      }
      
      console.log('✅ Vehicle ownership verified. Creating vehicle item...');
      const vehicleItem = await storage.createVehicleItem(validatedData);
      console.log('✅ Vehicle item created successfully:', vehicleItem.id);
      
      // Materialize occurrence reminders
      await storage.materializeOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: "vehicle_item",
        entityId: vehicleItem.id,
        taskTitle: vehicleItem.title,
        isRecurring: !!vehicleItem.isRecurring,
        dueDateYmd: typeof vehicleItem.dueDate === 'string' ? vehicleItem.dueDate : new Date(vehicleItem.dueDate).toISOString().split('T')[0],
        nextDueDateYmd: vehicleItem.nextDueDate ? (typeof vehicleItem.nextDueDate === 'string' ? vehicleItem.nextDueDate : new Date(vehicleItem.nextDueDate).toISOString().split('T')[0]) : null,
        recurrenceData: vehicleItem.recurrenceData,
        reminderOffsetValue: vehicleItem.reminderOffsetValue ?? vehicleItem.reminderDays ?? DEFAULT_REMINDER_OFFSET_VALUE,
        reminderOffsetUnit: vehicleItem.reminderOffsetUnit ?? 'days',
        notificationChannels: parseJsonArray(vehicleItem.notificationChannels),
        emailRecipients: parseJsonArray(vehicleItem.emailRecipients),
        whatsappRecipients: parseJsonArray(vehicleItem.whatsappRecipients),
        smsRecipients: [],
        reminderTimes: parseJsonArray(vehicleItem.reminderTimes),
      });
      
      res.status(201).json(vehicleItem);
    } catch (error) {
      console.error('❌ Error creating vehicle item:', error);
      if (error instanceof z.ZodError) {
        console.error('❌ Zod validation errors:', JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      console.error('❌ Unexpected error:', error instanceof Error ? error.message : error);
      next(error);
    }
  });

  app.put("/api/vehicle-items/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      
      console.log('📝 Updating vehicle item with payload:', JSON.stringify(req.body, null, 2));
      
      // Verify ownership through vehicle
      const existingVehicleItem = await storage.getVehicleItem(id);
      if (!existingVehicleItem) {
        return res.status(404).json({ message: "Vehicle item not found" });
      }
      
      const vehicle = await storage.getVehicle(existingVehicleItem.vehicleId);
      if (!vehicle || vehicle.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      const itemCompleted =
        (existingVehicleItem.status || "").toLowerCase() === "completed";

      if (!existingVehicleItem.isRecurring && itemCompleted) {
        return res.status(409).json({
          message:
            "Completed one-time tasks cannot be edited. Create a new task instead.",
        });
      }
      
      // Validate input (partial schema with passthrough to allow helper fields like _emailRecipients)
      const parsedData = updateVehicleItemSchema.parse(req.body);
      const { _emailRecipients: _ignoreEmailRecipients, ...validatedData } = parsedData;
      
      console.log('✅ Validation passed. Validated data:', JSON.stringify(validatedData, null, 2));

      // Detect changes to title and emailRecipients for selective sync
      const titleChanged = validatedData.title !== undefined && validatedData.title !== existingVehicleItem.title;
      const emailRecipientsChanged = validatedData.emailRecipients !== undefined;

      let vehicleItem = existingVehicleItem;
      if (Object.keys(validatedData).length > 0) {
        vehicleItem = await storage.updateVehicleItem(id, validatedData);
      }
      
      // If only title/emailRecipients/customFields changed, use selective sync
      const structuralFieldsChanged = 
        validatedData.dueDate !== undefined ||
        validatedData.isRecurring !== undefined ||
        validatedData.recurrenceData !== undefined ||
        validatedData.reminderOffsetValue !== undefined ||
        validatedData.reminderOffsetUnit !== undefined ||
        validatedData.reminderTimes !== undefined ||
        validatedData.notificationChannels !== undefined;

      if (structuralFieldsChanged) {
        // Structural changes: recreate all reminders
        await storage.materializeOccurrenceRemindersForEntity({
          userId,
          entityType: "vehicle_item",
          entityId: id,
          taskTitle: vehicleItem.title,
          isRecurring: !!vehicleItem.isRecurring,
          dueDateYmd: typeof vehicleItem.dueDate === 'string' ? vehicleItem.dueDate : new Date(vehicleItem.dueDate).toISOString().split('T')[0],
          nextDueDateYmd: vehicleItem.nextDueDate ? (typeof vehicleItem.nextDueDate === 'string' ? vehicleItem.nextDueDate : new Date(vehicleItem.nextDueDate).toISOString().split('T')[0]) : null,
          recurrenceData: vehicleItem.recurrenceData,
          reminderOffsetValue: vehicleItem.reminderOffsetValue ?? vehicleItem.reminderDays ?? DEFAULT_REMINDER_OFFSET_VALUE,
          reminderOffsetUnit: vehicleItem.reminderOffsetUnit ?? 'days',
          notificationChannels: parseJsonArray(vehicleItem.notificationChannels),
          emailRecipients: parseJsonArray(vehicleItem.emailRecipients),
          whatsappRecipients: parseJsonArray(vehicleItem.whatsappRecipients),
          smsRecipients: [],
          reminderTimes: parseJsonArray(vehicleItem.reminderTimes),
        });
      } else if (titleChanged || emailRecipientsChanged) {
        // Only title/recipients changed: sync future reminders only
        await storage.syncFutureOccurrenceRemindersForEntity({
          userId,
          entityType: "vehicle_item",
          entityId: id,
          newTitle: titleChanged ? vehicleItem.title : undefined,
          newEmailRecipients: emailRecipientsChanged ? parseJsonArray(vehicleItem.emailRecipients) : undefined,
        });
      }
      
      res.json(vehicleItem);
    } catch (error) {
      console.error('❌ Error updating vehicle item:', error);
      if (error instanceof z.ZodError) {
        console.error('❌ Zod validation errors:', JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/vehicle-items/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      
      // Verify ownership through vehicle
      const existingVehicleItem = await storage.getVehicleItem(id);
      if (!existingVehicleItem) {
        return res.status(404).json({ message: "Vehicle item not found" });
      }
      
      const vehicle = await storage.getVehicle(existingVehicleItem.vehicleId);
      if (!vehicle || vehicle.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ✅ Explicit cleanup: delete occurrence_reminders for this entity
      await storage.deleteOccurrenceRemindersForEntity({
        userId,
        entityType: 'vehicle_item',
        entityId: id,
      });
      
      // Delete the parent entity (also triggers DB-level cascade, but we're explicit)
      await storage.deleteVehicleItem(id);
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  // ✅ METADATA-ONLY EDIT: Get current recipients from occurrence_reminders
  app.get("/api/task-metadata/:entityType/:entityId/recipients", requireAuth, async (req, res, next) => {
    try {
      const { entityType, entityId } = req.params;
      const userId = req.user!.id;

      // Validate entity type
      const validEntityTypes = ['vehicle_item', 'asset_item', 'task_action_item', 'tax_legal_item'];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type" });
      }

      const recipients = await storage.getCurrentRecipientsFromOccurrenceReminders(userId, entityType, entityId);
      res.json({ recipients });
    } catch (error) {
      console.error("GET /api/task-metadata/:entityType/:entityId/recipients failed", error);
      next(error);
    }
  });

  // ✅ METADATA-ONLY EDIT: Update vehicle item metadata (title, contacts, recipients)
  app.patch("/api/vehicle-items/:id/metadata", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const { title, contacts, recipients } = req.body;

      // Verify ownership
      const existingItem = await storage.getVehicleItem(id);
      if (!existingItem) {
        return res.status(404).json({ message: "Vehicle item not found" });
      }

      const vehicle = await storage.getVehicle(existingItem.vehicleId);
      if (!vehicle || vehicle.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Update metadata
      const result = await storage.updateTaskMetadata(userId, 'vehicle_item', id, { title, contacts, recipients });
      
      // Fetch updated task to return fresh data
      const updatedTask = await storage.getVehicleItem(id);
      
      // ✅ Compute editability status AFTER update
      const editabilityStatus = await storage.getTaskRecipientsEditabilityStatus(userId, 'vehicle_item', id);
      
      res.json({ 
        message: "Metadata updated successfully",
        updatedRemindersCount: result.updatedRemindersCount,
        updatedTask: {
          id: updatedTask!.id,
          title: updatedTask!.title,
          emailRecipients: updatedTask!.emailRecipients,
          customFields: updatedTask!.customFields,
        },
        eligibleUpcomingUnsentCount: editabilityStatus.eligibleUpcomingUnsentCount,
        futureGenerationPossible: editabilityStatus.futureGenerationPossible,
        shouldLockEmailRecipients: editabilityStatus.shouldLockEmailRecipients,
      });
    } catch (error) {
      console.error("PATCH /api/vehicle-items/:id/metadata failed", error);
      next(error);
    }
  });

  // Assets API
  app.get("/api/assets", requireAuth, async (req, res, next) => {
    try {
      const assets = await storage.getAssetsByUser(req.user!.id);
      
      // ✅ Compute summaries from occurrence_reminders (single source of truth)
      const { getOccurrenceSummariesGroupedByParent } = await import('./lib/occurrence-summary');
      const assetIds = assets.map(a => a.id);
      const summariesMap = await getOccurrenceSummariesGroupedByParent(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          parentIds: assetIds,
          entityType: 'asset_item',
          itemsTable: assetItems,
          itemIdCol: assetItems.id,
          parentIdCol: assetItems.assetId,
        }
      );
      
      // Attach summaries to each asset
      const assetsWithSummaries = assets.map(asset => ({
        ...asset,
        occurrenceSummary: summariesMap.get(asset.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(assetsWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  const normalizeAssetPayload = (body: any) =>
    normalizeByMap(
      body,
      {
        assetType: ["asset_type"],
        serialNumber: ["serial_number"],
        purchaseDate: ["purchase_date"],
        purchaseAmount: ["purchase_amount"],
        boughtUnder: ["bought_under"],
        depreciationPercent: ["depreciation_percent"],
        depreciationMethod: ["depreciation_method"],
      },
      { mode: "create" }
    );

  app.put("/api/assets/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const existing = await storage.getAsset(id);
      if (!existing || existing.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Normalize payload to canonical camelCase keys, then validate partial update
      const normalized = normalizeAssetPayload(req.body);
      const validatedData = insertAssetSchema
        .partial()
        .strict()
        .omit({ createdBy: true })
        .parse(normalized);

      const updated = await storage.updateAsset(id, validatedData);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/assets/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const existing = await storage.getAsset(id);
      if (!existing || existing.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // ✅ CASCADE DELETE: Delete child asset_items first, then the asset
      // This triggers DB-level deletion of occurrence_reminders via triggers
      const assetItems = await storage.getAssetItemsByAsset(id);
      
      console.log(`🗑️  Deleting asset ${id} with ${assetItems.length} child item(s)`);
      
      // Delete each child asset_item (which also deletes their occurrence_reminders via our explicit cleanup + DB triggers)
      for (const item of assetItems) {
        // Verify child ownership (should match parent ownership, but defensive check)
        if (item.createdBy === userId) {
          await storage.deleteOccurrenceRemindersForEntity({
            userId,
            entityType: 'asset_item',
            entityId: item.id,
          });
          await storage.deleteAssetItem(item.id);
          console.log(`   ✅ Deleted child asset_item: ${item.id}`);
        }
      }
      
      // Delete the parent asset
      await storage.deleteAsset(id);
      console.log(`   ✅ Deleted parent asset: ${id}`);
      
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

    app.post("/api/assets", requireAuth, async (req, res, next) => {
      try {
        const normalized = normalizeAssetPayload(req.body);
        const validatedData = insertAssetSchema.parse({
          ...normalized,
          createdBy: req.user!.id,
        });
        const asset = await storage.createAsset(validatedData);
        res.status(201).json(asset);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Validation error", errors: error.errors });
        }
        next(error);
      }
    });

  // Test-only helper endpoint for counting reminder schedules (guards invariants)
  // Enable test helpers; guarded by requireAuth to avoid public exposure.
  const enableTestHelpers = true;

  if (enableTestHelpers) {
  }

  // Asset Items API
  app.get("/api/asset-items", requireAuth, async (req, res, next) => {
    try {
      const assetItems = await storage.getAssetItemsByUser(req.user!.id);
      res.json(assetItems);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/asset-items", requireAuth, async (req, res, next) => {
    try {
      // Strip category/subCategory fields (columns dropped from DB)
      const { category, subCategory, sub_category, ...cleanBody } = req.body;
      
      const validatedData = insertAssetItemSchema.parse({
        ...cleanBody,
        createdBy: req.user!.id,
      });
      const assetItem = await storage.createAssetItem(validatedData);
      res.status(201).json(assetItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  // Asset Tasks (per-asset)
  app.get("/api/assets/:assetId/tasks", requireAuth, async (req, res, next) => {
    try {
      const { assetId } = req.params;
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const items = await storage.getAssetItemsByAsset(assetId);
      
      // Attach occurrence summaries for each item
      const { getOccurrenceSummariesForEntityIds } = await import('./lib/occurrence-summary');
      const itemIds = items.map(item => item.id);
      const summariesMap = await getOccurrenceSummariesForEntityIds(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          entityIds: itemIds,
          entityType: 'asset_item',
        }
      );
      
      const itemsWithSummaries = items.map(item => ({
        ...item,
        occurrenceSummary: summariesMap.get(item.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(itemsWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assets/:assetId/tasks", requireAuth, async (req, res, next) => {
    try {
      const { assetId } = req.params;
      const asset = await storage.getAsset(assetId);
      if (!asset || asset.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      // IMPORTANT: Normalize payload to canonical camelCase keys
      const normalized = normalizeAssetItemPayload(req.body, { mode: "create" });
      
      // Vehicles pattern: coerce arrays to JSON strings before DB insert
      const coerced = coerceAssetItemForDb(normalized);
      
      // Strip category/subCategory fields (columns dropped from DB)
      const { category, subCategory, sub_category, ...cleanCoerced } = coerced;

      // Server sets these, client should not be required to send them
      const validatedData = insertAssetItemSchema.parse({
        ...cleanCoerced,
        assetId, // must be camelCase Drizzle key
        createdBy: req.user!.id,
      });

      const item = await storage.createAssetItem(validatedData);
      
      // Materialize occurrence reminders
      await storage.materializeOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: "asset_item",
        entityId: item.id,
        taskTitle: item.title,
        isRecurring: !!item.isRecurring,
        dueDateYmd: typeof item.dueDate === 'string' ? item.dueDate : new Date(item.dueDate).toISOString().split('T')[0],
        nextDueDateYmd: item.nextDueDate ? (typeof item.nextDueDate === 'string' ? item.nextDueDate : new Date(item.nextDueDate).toISOString().split('T')[0]) : null,
        recurrenceData: item.recurrenceData,
        reminderOffsetValue: item.reminderOffsetValue ?? item.reminderDays ?? DEFAULT_REMINDER_OFFSET_VALUE,
        reminderOffsetUnit: item.reminderOffsetUnit ?? 'days',
        notificationChannels: parseJsonArray(item.notificationChannels),
        emailRecipients: parseJsonArray(item.emailRecipients),
        whatsappRecipients: parseJsonArray(item.whatsappRecipients),
        smsRecipients: [],
        reminderTimes: parseJsonArray(item.reminderTimes),
      });
      
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      // Always return JSON 500 (don't call next(error) which can crash the server)
      const e = error as any;
      console.error("[asset task create] error", {
        message: e?.message,
        code: e?.code,
        detail: e?.detail,
        constraint: e?.constraint,
        stack: e?.stack,
      });
      return res.status(500).json({
        message: "Server error",
        error: String(e?.message || error),
        code: e?.code,
        detail: e?.detail,
        constraint: e?.constraint,
      });
    }
  });

  app.put("/api/assets/tasks/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const existing = await storage.getAssetItem(taskId);
      if (!existing) {
        return res.status(404).json({ message: "Asset task not found" });
      }
      const asset = await storage.getAsset(existing.assetId);
      if (!asset || asset.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = updateAssetItemSchema.parse(req.body);
      const { _emailRecipients: _ignore, ...validatedData } = parsed;

      // Detect changes for selective sync
      const titleChanged = validatedData.title !== undefined && validatedData.title !== existing.title;
      const emailRecipientsChanged = validatedData.emailRecipients !== undefined;

      const updated = await storage.updateAssetItem(taskId, validatedData);

      // Check if structural fields changed
      const structuralFieldsChanged = 
        validatedData.dueDate !== undefined ||
        validatedData.isRecurring !== undefined ||
        validatedData.recurrenceData !== undefined ||
        validatedData.reminderOffsetValue !== undefined ||
        validatedData.reminderOffsetUnit !== undefined ||
        validatedData.reminderTimes !== undefined ||
        validatedData.notificationChannels !== undefined;

      if (structuralFieldsChanged) {
        // Structural changes: recreate all reminders
        await storage.materializeOccurrenceRemindersForEntity({
          userId: req.user!.id,
          entityType: "asset_item",
          entityId: updated.id,
          taskTitle: updated.title,
          isRecurring: !!updated.isRecurring,
          dueDateYmd: typeof updated.dueDate === 'string' ? updated.dueDate : new Date(updated.dueDate).toISOString().split('T')[0],
          nextDueDateYmd: updated.nextDueDate ? (typeof updated.nextDueDate === 'string' ? updated.nextDueDate : new Date(updated.nextDueDate).toISOString().split('T')[0]) : null,
          recurrenceData: updated.recurrenceData,
          reminderOffsetValue: updated.reminderOffsetValue ?? updated.reminderDays ?? DEFAULT_REMINDER_OFFSET_VALUE,
          reminderOffsetUnit: updated.reminderOffsetUnit ?? 'days',
          notificationChannels: parseJsonArray(updated.notificationChannels),
          emailRecipients: parseJsonArray(updated.emailRecipients),
          whatsappRecipients: parseJsonArray(updated.whatsappRecipients),
          smsRecipients: [],
          reminderTimes: parseJsonArray(updated.reminderTimes),
        });
      } else if (titleChanged || emailRecipientsChanged) {
        // Only title/recipients changed: sync future reminders only
        await storage.syncFutureOccurrenceRemindersForEntity({
          userId: req.user!.id,
          entityType: "asset_item",
          entityId: updated.id,
          newTitle: titleChanged ? updated.title : undefined,
          newEmailRecipients: emailRecipientsChanged ? parseJsonArray(updated.emailRecipients) : undefined,
        });
      }

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/assets/tasks/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const existing = await storage.getAssetItem(taskId);
      if (!existing) {
        return res.status(404).json({ message: "Asset task not found" });
      }
      const asset = await storage.getAsset(existing.assetId);
      if (!asset || asset.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteAssetItem(taskId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/asset-items/:id", requireAuth, async (req, res, next) => {
    try {
      const assetItem = await storage.getAssetItem(req.params.id);
      if (!assetItem) {
        return res.status(404).json({ message: "Asset item not found" });
      }
      
      // Verify ownership through asset
      const asset = await storage.getAsset(assetItem.assetId);
      if (!asset || asset.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ✅ Explicit cleanup: delete occurrence_reminders for this entity
      await storage.deleteOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: 'asset_item',
        entityId: req.params.id,
      });
      
      // Delete the parent entity (also triggers DB-level cascade, but we're explicit)
      await storage.deleteAssetItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ✅ METADATA-ONLY EDIT: Update asset item metadata
  app.patch("/api/assets/:assetId/tasks/:id/metadata", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const { title, contacts, recipients } = req.body;

      // Verify ownership
      const existingItem = await storage.getAssetItem(id);
      if (!existingItem) {
        return res.status(404).json({ message: "Asset item not found" });
      }

      const asset = await storage.getAsset(existingItem.assetId);
      if (!asset || asset.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Update metadata
      const result = await storage.updateTaskMetadata(userId, 'asset_item', id, { title, contacts, recipients });
      
      // Fetch updated task to return fresh data
      const updatedTask = await storage.getAssetItem(id);
      
      // ✅ Compute editability status AFTER update
      const editabilityStatus = await storage.getTaskRecipientsEditabilityStatus(userId, 'asset_item', id);
      
      res.json({ 
        message: "Metadata updated successfully",
        updatedRemindersCount: result.updatedRemindersCount,
        updatedTask: {
          id: updatedTask!.id,
          title: updatedTask!.title,
          emailRecipients: updatedTask!.emailRecipients,
          customFields: updatedTask!.customFields,
        },
        eligibleUpcomingUnsentCount: editabilityStatus.eligibleUpcomingUnsentCount,
        futureGenerationPossible: editabilityStatus.futureGenerationPossible,
        shouldLockEmailRecipients: editabilityStatus.shouldLockEmailRecipients,
      });
    } catch (error) {
      console.error("PATCH /api/assets/:assetId/tasks/:id/metadata failed", error);
      next(error);
    }
  });

  // Task Action Items API
  app.get("/api/task-action-items", requireAuth, async (req, res, next) => {
    try {
      const { taskActionId } = req.query;
      if (typeof taskActionId === "string") {
        const parent = await storage.getTaskAction(taskActionId);
        if (!parent || parent.createdBy !== req.user!.id) {
          return res.status(403).json({ message: "Access denied" });
        }
        const items = await storage.getTaskActionItemsByTaskAction(taskActionId);
        return res.json(items);
      }
      const items = await storage.getTaskActionItemsByUser(req.user!.id);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/task-action-items/:id", requireAuth, async (req, res, next) => {
    try {
      const item = await storage.getTaskActionItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Task action item not found" });
      }
      const parent = await storage.getTaskAction(item.taskActionId);
      if (!parent || parent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      res.json(item);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/task-action-items", requireAuth, async (req, res, next) => {
    try {
      // Strip category/subCategory fields (columns dropped from DB)
      const { category, subCategory, sub_category, ...cleanBody } = req.body;
      
      const validated = insertTaskActionItemSchema.parse({
        ...cleanBody,
        createdBy: req.user!.id,
      });
      const parent = await storage.getTaskAction(validated.taskActionId);
      if (!parent || parent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const item = await storage.createTaskActionItem(validated);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.put("/api/task-action-items/:id", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const existing = await storage.getTaskActionItem(id);
      if (!existing) {
        return res.status(404).json({ message: "Task action item not found" });
      }
      const parent = await storage.getTaskAction(existing.taskActionId);
      if (!parent || parent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = updateTaskActionItemSchema.parse(req.body);
      const { _emailRecipients: _ignore, ...validated } = parsed as any;

      const updated = await storage.updateTaskActionItem(id, validated);

      await storage.deleteOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: "task_action_item",
        entityId: id,
      });
      await upsertRemindersForTaskActionItem(req.user!.id, updated);

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/task-action-items/:id", requireAuth, async (req, res, next) => {
    try {
      const item = await storage.getTaskActionItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Task action item not found" });
      }
      const parent = await storage.getTaskAction(item.taskActionId);
      if (!parent || parent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      // ✅ Explicit cleanup: delete occurrence_reminders for this entity
      await storage.deleteOccurrenceRemindersForEntity({
        userId: req.user!.id,
        entityType: 'task_action_item',
        entityId: req.params.id,
      });

      // Delete the parent entity (also triggers DB-level cascade, but we're explicit)
      await storage.deleteTaskActionItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // ✅ METADATA-ONLY EDIT: Update task action item metadata
  app.patch("/api/task-actions/:taskActionId/tasks/:id/metadata", requireAuth, async (req, res, next) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const { title, contacts, recipients } = req.body;

      // Verify ownership
      const existingItem = await storage.getTaskActionItem(id);
      if (!existingItem) {
        return res.status(404).json({ message: "Task action item not found" });
      }

      const taskAction = await storage.getTaskAction(existingItem.taskActionId);
      if (!taskAction || taskAction.createdBy !== userId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Update metadata
      const result = await storage.updateTaskMetadata(userId, 'task_action_item', id, { title, contacts, recipients });
      
      // Fetch updated task to return fresh data
      const updatedTask = await storage.getTaskActionItem(id);
      
      // ✅ Compute editability status AFTER update
      const editabilityStatus = await storage.getTaskRecipientsEditabilityStatus(userId, 'task_action_item', id);
      
      res.json({ 
        message: "Metadata updated successfully",
        updatedRemindersCount: result.updatedRemindersCount,
        updatedTask: {
          id: updatedTask!.id,
          title: updatedTask!.title,
          emailRecipients: updatedTask!.emailRecipients,
          customFields: updatedTask!.customFields,
        },
        eligibleUpcomingUnsentCount: editabilityStatus.eligibleUpcomingUnsentCount,
        futureGenerationPossible: editabilityStatus.futureGenerationPossible,
        shouldLockEmailRecipients: editabilityStatus.shouldLockEmailRecipients,
      });
    } catch (error) {
      console.error("PATCH /api/task-actions/:taskActionId/tasks/:id/metadata failed", error);
      next(error);
    }
  });

  // Task Action Tasks (per-parent)
  app.get("/api/task-actions/:taskActionId/tasks", requireAuth, async (req, res, next) => {
    try {
      const { taskActionId } = req.params;
      const taskAction = await storage.getTaskAction(taskActionId);
      if (!taskAction || taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const items = await storage.getTaskActionItemsByTaskAction(taskActionId);
      
      // Attach occurrence summaries for each item
      const { getOccurrenceSummariesForEntityIds } = await import('./lib/occurrence-summary');
      const itemIds = items.map(item => item.id);
      const summariesMap = await getOccurrenceSummariesForEntityIds(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          entityIds: itemIds,
          entityType: 'task_action_item',
        }
      );
      
      const itemsWithSummaries = items.map(item => ({
        ...item,
        occurrenceSummary: summariesMap.get(item.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(itemsWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/task-actions/:taskActionId/tasks", requireAuth, async (req, res, next) => {
    try {
      const { taskActionId } = req.params;
      const taskAction = await storage.getTaskAction(taskActionId);
      if (!taskAction || taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Strip category/subCategory fields (columns dropped from DB)
      const { category, subCategory, sub_category, ...cleanBody } = req.body;

      const validated = insertTaskActionItemSchema.parse({
        ...cleanBody,
        taskActionId,
        createdBy: req.user!.id,
      });

      const item = await storage.createTaskActionItem(validated);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      const e = error as any;
      console.error("[task action task create] error", {
        message: e?.message,
        code: e?.code,
        detail: e?.detail,
        constraint: e?.constraint,
        stack: e?.stack,
      });
      return res.status(500).json({
        message: "Server error",
        error: String(e?.message || error),
        code: e?.code,
        detail: e?.detail,
        constraint: e?.constraint,
      });
    }
  });

  app.put("/api/task-actions/tasks/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const existing = await storage.getTaskActionItem(taskId);
      if (!existing) {
        return res.status(404).json({ message: "Task action task not found" });
      }
      const taskAction = await storage.getTaskAction(existing.taskActionId);
      if (!taskAction || taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const parsed = updateTaskActionItemSchema.parse(req.body);
      const { _emailRecipients: _ignore, ...validated } = parsed as any;

      // Detect changes for selective sync
      const titleChanged = validated.title !== undefined && validated.title !== existing.title;
      const emailRecipientsChanged = validated.emailRecipients !== undefined;

      const updated = await storage.updateTaskActionItem(taskId, validated);

      // Check if structural fields changed
      const structuralFieldsChanged = 
        validated.dueDate !== undefined ||
        validated.isRecurring !== undefined ||
        validated.recurrenceData !== undefined ||
        validated.reminderOffsetValue !== undefined ||
        validated.reminderOffsetUnit !== undefined ||
        validated.reminderTimes !== undefined ||
        validated.notificationChannels !== undefined;

      if (structuralFieldsChanged) {
        // Structural changes: recreate all reminders
        await storage.deleteOccurrenceRemindersForEntity({
          userId: req.user!.id,
          entityType: "task_action_item",
          entityId: taskId,
        });
        await upsertRemindersForTaskActionItem(req.user!.id, updated);
      } else if (titleChanged || emailRecipientsChanged) {
        // Only title/recipients changed: sync future reminders only
        await storage.syncFutureOccurrenceRemindersForEntity({
          userId: req.user!.id,
          entityType: "task_action_item",
          entityId: updated.id,
          newTitle: titleChanged ? updated.title : undefined,
          newEmailRecipients: emailRecipientsChanged ? parseJsonArray(updated.emailRecipients) : undefined,
        });
      }

      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/task-actions/tasks/:taskId", requireAuth, async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const existing = await storage.getTaskActionItem(taskId);
      if (!existing) {
        return res.status(404).json({ message: "Task action task not found" });
      }
      const taskAction = await storage.getTaskAction(existing.taskActionId);
      if (!taskAction || taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteTaskActionItem(taskId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Task Actions API
  app.get("/api/task-actions", requireAuth, async (req, res, next) => {
    try {
      // Return all task actions for now to avoid hiding existing rows created by other users.
      const taskActions = await storage.getAllTaskActions();
      
      // ✅ Compute summaries from occurrence_reminders (single source of truth)
      const { getOccurrenceSummariesGroupedByParent } = await import('./lib/occurrence-summary');
      const taskActionIds = taskActions.map(ta => ta.id);
      const summariesMap = await getOccurrenceSummariesGroupedByParent(
        (storage as any).dbx,
        {
          userId: req.user!.id,
          parentIds: taskActionIds,
          entityType: 'task_action_item',
          itemsTable: taskActionItems,
          itemIdCol: taskActionItems.id,
          parentIdCol: taskActionItems.taskActionId,
        }
      );
      
      // Attach summaries to each task action
      const taskActionsWithSummaries = taskActions.map(taskAction => ({
        ...taskAction,
        occurrenceSummary: summariesMap.get(taskAction.id) || {
          itemsCount: 0,
          pendingCount: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          nextDueOccurrence: null,
        },
      }));
      
      res.json(taskActionsWithSummaries);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/task-actions", requireAuth, async (req, res, next) => {
    try {
      const sanitized = sanitizeTaskActionPayload({ ...req.body, createdBy: req.user!.id });
      const validatedData = insertTaskActionSchema.parse(sanitized);
      const taskAction = await storage.createTaskAction(validatedData);
      res.status(201).json(taskAction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.get("/api/task-actions/:id", requireAuth, async (req, res, next) => {
    try {
      const taskAction = await storage.getTaskAction(req.params.id);
      if (!taskAction) {
        return res.status(404).json({ message: "Task action not found" });
      }
      
      // Verify ownership
      if (taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(taskAction);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/task-actions/:id", requireAuth, async (req, res, next) => {
    try {
      const taskAction = await storage.getTaskAction(req.params.id);
      if (!taskAction) {
        return res.status(404).json({ message: "Task action not found" });
      }
      
      // Verify ownership
      if (taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const sanitized = sanitizeTaskActionPayload(req.body);
      const validatedData = insertTaskActionSchema.partial().parse(sanitized);
      const updatedTaskAction = await storage.updateTaskAction(req.params.id, validatedData);
      res.json(updatedTaskAction);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/task-actions/:id", requireAuth, async (req, res, next) => {
    try {
      const taskAction = await storage.getTaskAction(req.params.id);
      if (!taskAction) {
        return res.status(404).json({ message: "Task action not found" });
      }
      
      // Verify ownership
      if (taskAction.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // ✅ CASCADE DELETE: Delete child task_action_items first, then the task action
      const taskActionItems = await storage.getTaskActionItemsByTaskAction(req.params.id);
      
      console.log(`🗑️  Deleting task action ${req.params.id} with ${taskActionItems.length} child item(s)`);
      
      // Delete each child task_action_item
      for (const item of taskActionItems) {
        if (item.createdBy === req.user!.id) {
          await storage.deleteOccurrenceRemindersForEntity({
            userId: req.user!.id,
            entityType: 'task_action_item',
            entityId: item.id,
          });
          await storage.deleteTaskActionItem(item.id);
          console.log(`   ✅ Deleted child task_action_item: ${item.id}`);
        }
      }
      
      // Delete the parent task action
      await storage.deleteTaskAction(req.params.id);
      console.log(`   ✅ Deleted parent task action: ${req.params.id}`);
      
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  // Calendar Events API (Quick Events)
  app.get("/api/calendar-events", requireAuth, async (req, res, next) => {
    try {
      const calendarEvents = await storage.getCalendarEventsByUser(req.user!.id);
      res.json(calendarEvents);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/calendar-events", requireAuth, async (req, res, next) => {
    try {
      const validatedData = insertCalendarEventSchema.parse({
        ...req.body,
        createdBy: req.user!.id,
      });
      const calendarEvent = await storage.createCalendarEvent(validatedData);
      res.status(201).json(calendarEvent);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.get("/api/calendar-events/:id", requireAuth, async (req, res, next) => {
    try {
      const calendarEvent = await storage.getCalendarEvent(req.params.id);
      if (!calendarEvent) {
        return res.status(404).json({ message: "Calendar event not found" });
      }
      
      // Verify ownership
      if (calendarEvent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(calendarEvent);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/calendar-events/:id", requireAuth, async (req, res, next) => {
    try {
      const calendarEvent = await storage.getCalendarEvent(req.params.id);
      if (!calendarEvent) {
        return res.status(404).json({ message: "Calendar event not found" });
      }
      
      // Verify ownership
      if (calendarEvent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      const validatedData = insertCalendarEventSchema.partial().parse(req.body);
      const updatedCalendarEvent = await storage.updateCalendarEvent(req.params.id, validatedData);
      res.json(updatedCalendarEvent);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation error", errors: error.errors });
      }
      next(error);
    }
  });

  app.delete("/api/calendar-events/:id", requireAuth, async (req, res, next) => {
    try {
      const calendarEvent = await storage.getCalendarEvent(req.params.id);
      if (!calendarEvent) {
        return res.status(404).json({ message: "Calendar event not found" });
      }
      
      // Verify ownership
      if (calendarEvent.createdBy !== req.user!.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      await storage.deleteCalendarEvent(req.params.id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
  // Task Completion endpoint - works for all entity types
  app.post("/api/tasks/complete", requireAuth, async (req, res, next) => {
    try {
      const { occurrenceKey, entityType, entityId, completionNotes } = req.body;

      // ✅ NEW: DB-driven completion (source of truth)
      // If the UI sends occurrenceKey, we complete the occurrence_reminders row(s) directly.
      if (typeof occurrenceKey === "string" && occurrenceKey.trim().length > 0) {
        const key = occurrenceKey.trim();

        const parsed = parseDbOccurrenceKey(key);
        if (!parsed) {
          return res.status(400).json({
            message:
              "Invalid occurrenceKey format. Expected <entityId>::<ISO_Z> (example: <uuid>::2025-12-01T04:30:00.000Z).",
          });
        }

        // ✅ GUARD: Prevent early completion - check due date
        // Query the due date from occurrence_reminders
        const dueDateQuery = await (storage as any).dbx.execute(sql`
          SELECT due_date_local_ymd, occurrence_task_utc
          FROM occurrence_reminders
          WHERE user_id = ${req.user!.id} AND occurrence_key = ${key}
          LIMIT 1
        `);

        const dueDateRow = (dueDateQuery as any).rows?.[0] ?? dueDateQuery?.[0];
        
        if (!dueDateRow) {
          return res.status(404).json({
            message: `No occurrence found for key: ${key}.`,
          });
        }

        // Use due_date_local_ymd (preferred) or occurrence_task_utc as fallback
        const dueDateToCheck = dueDateRow.due_date_local_ymd || dueDateRow.occurrence_task_utc;
        
        if (!isDueTodayOrPastIST(dueDateToCheck)) {
          return res.status(409).json({
            message: `Cannot complete before due date (${formatDueDateForError(dueDateToCheck)}).`,
          });
        }

        const result = await storage.completeOccurrenceByKey({
          userId: req.user!.id,
          occurrenceKey: key,
          note: completionNotes || "",
        });

        // ✅ Normal success
        if (result.rowsUpdated > 0) {
          console.log(`✅ Completed ${result.rowsUpdated} pending row(s) for key: ${key}`);
          return res.json({ message: "Task completed successfully", rowsUpdated: result.rowsUpdated });
        }

        // ✅ rowsUpdated === 0: decide why
        const agg = await storage.getOccurrenceKeyAggregate({
          userId: req.user!.id,
          occurrenceKey: key,
        });

        // ❌ truly not found
        if (agg.total === 0) {
          return res.status(404).json({
            message: `No occurrence found for key: ${key}.`,
          });
        }

        // ✅ already completed (idempotent no-op)
        if (agg.completed === agg.total) {
          return res.json({
            message: "Task already completed",
            rowsUpdated: 0,
          });
        }

        // ⚠️ exists but no pending rows (e.g., skipped)
        return res.status(409).json({
          message: "Occurrence exists but has no pending rows to complete.",
          rowsUpdated: 0,
          statusBreakdown: agg,
        });
      }

      // ---- existing legacy path (entity completion) ----
      // Validate entity type
      const validEntityTypes = ['tax_item', 'vehicle_item', 'asset_item', 'task_action_item', 'task_action', 'calendar_event', 'tax_legal_item'];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type" });
      }

      // Guard against non-UUID entity ids (prevents occurrence_key strings from reaching DB)
      if (!isUuid(entityId)) {
        return res.status(400).json({ message: "Invalid entityId (must be a UUID)"}); 
      }

      // Verify ownership
      const isOwner = await verifyEntityOwnership(entityType, entityId, req.user!.id);
      if (!isOwner) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.completeTask(
        entityType as 'tax_item' | 'vehicle_item' | 'asset_item' | 'task_action' | 'calendar_event',
        entityId,
        completionNotes || '',
        req.user!.id
      );

      res.json({ message: "Task completed successfully" });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Derive orgId from request with strict production fail-closed logic
   */
  function getEffectiveOrgId(req: Request): string {
    const orgId = req.user?.orgId;
    if (orgId) return orgId;
    
    // Fallback to userId unless SINGLE_TENANT_MODE is explicitly 'false'
    const isSingleTenant = process.env.SINGLE_TENANT_MODE !== 'false';
    if (isSingleTenant && req.user?.id) {
      return req.user.id;
    }
    
    throw new Error('Forbidden: Organization context missing');
  }

  // HR Employees API
  app.get("/api/hr-employees", requireAuth, async (req, res, next) => {
    try {
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      
      // In this app, org_id maps to firm_id in hr_employees
      const employees = await storage.getHrEmployees(orgId);
      
      // Enhance with signed URLs for photos
      const enhancedEmployees = await Promise.all(employees.map(async (emp) => {
        const storagePath = emp.employeePhotoPath || emp.photoBucketKey;
        if (storagePath) {
          try {
            const bucket = getTaskLedgerBucket();
            const photoUrl = await objectStorageService.getPreviewURL(bucket, storagePath);
            return { ...emp, photoUrl };
          } catch (error) {
            console.error(`Error generating photo URL for employee ${emp.id}:`, error);
            return { ...emp, photoUrl: null };
          }
        }
        return { ...emp, photoUrl: null };
      }));

      res.json(enhancedEmployees);
    } catch (error) {
      next(error);
    }
  });

  // ⭐ Task Ledger Documents API (new normalized structure with bucket_key)
  const ALLOWED_ENTITY_TYPES = [
    'property', 'vehicle', 'asset', 'task_action', 'tax_legal_compliance',
    'tax_item', 'vehicle_item', 'asset_item', 'task_action_item', 'tax_legal_item'
  ];
  
  // Get signed upload URL with structured bucket path
  app.post("/api/task-ledger-objects/upload", requireAuth, async (req, res) => {
    try {
      const { entityType, entityId, fileName, mimeType, sizeBytes } = req.body;
      const userId = req.user!.id;
      
      // Determine orgId with strict environment check
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      
      // Validate entityType
      if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType)) {
        return res.status(400).json({ 
          error: `Invalid entityType. Must be one of: ${ALLOWED_ENTITY_TYPES.join(', ')}` 
        });
      }
      
      // Validate entityId is UUID
      if (!entityId || !isUuid(entityId)) {
        return res.status(400).json({ error: 'entityId must be a valid UUID' });
      }
      
      // Validate fileName
      if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ error: 'fileName is required' });
      }
      
      // Generate document ID before building key so storage path is deterministic
      const documentId = crypto.randomUUID();
      const bucketKey = buildTaskLedgerObjectKey({ orgId, documentId, originalFileName: fileName });
      
      const bucket = getTaskLedgerBucket();
      
      // Get signed upload URL from S3
      const uploadURL = await objectStorageService.getUploadURL(bucket, bucketKey);
      
      console.log(`[UPLOAD_URL_DEBUG] Generated signed upload URL. Bucket: "${bucket}", Key: "${bucketKey}", OrgId: "${orgId}"`);
      
      res.json({
        uploadURL: uploadURL.uploadURL,
        bucket,
        bucketKey,
        documentId,
        token: uploadURL.token,
      });
    } catch (error) {
      console.error("Error getting task ledger upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL", details: error instanceof Error ? error.message : String(error) });
    }
  });

  // Create task ledger document with link
  app.post("/api/task-ledger-documents", requireAuth, async (req, res, next) => {
    try {
      const { entityType, entityId, documentType, bucketKey, mimeType, sizeBytes, originalName } = req.body;
      const userId = req.user!.id;
      
      // Validate required fields
      if (!entityType || !ALLOWED_ENTITY_TYPES.includes(entityType)) {
        return res.status(400).json({ error: 'Invalid entityType' });
      }
      if (!entityId || !isUuid(entityId)) {
        return res.status(400).json({ error: 'entityId must be a valid UUID' });
      }
      if (!bucketKey || typeof bucketKey !== 'string') {
        return res.status(400).json({ error: 'bucketKey is required' });
      }
      if (!mimeType || typeof mimeType !== 'string') {
        return res.status(400).json({ error: 'mimeType is required' });
      }
      if (!originalName || typeof originalName !== 'string') {
        return res.status(400).json({ error: 'originalName is required' });
      }
      
      // Determine orgId with strict environment check
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      
      const bucket = getTaskLedgerBucket();

      // 1) Fetch the uploaded file bytes server-side to compute SHA256
      // This satisfies the "Compute sha256 server-side" requirement without UI changes.
      let fileBuffer: Buffer;
      try {
        fileBuffer = await objectStorageService.getObjectBuffer(bucket, bucketKey);
      } catch (error) {
        console.error("Failed to fetch uploaded file for deduplication:", error);
        return res.status(400).json({ error: "Could not verify uploaded file" });
      }

      // 2) Use the new DRY storage function for deduplication and link creation
      console.log(`[DOC_CREATE_DEBUG] Finalizing document. Temporary Key: "${bucketKey}", OrgId: "${orgId}"`);
      const { document, link } = await storage.upsertTaskLedgerDocumentAndLinkFromUpload({
        orgId,
        userId,
        entityType,
        entityId,
        documentType: documentType || undefined,
        fileName: originalName,
        mimeType,
        sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : fileBuffer.length,
        fileBuffer
      });

      // 3) Clean up: If the deduplicated document uses a different bucket key than what was just uploaded,
      // it means we can delete the redundant file the client just uploaded.
      if (document.bucketKey !== bucketKey) {
        await objectStorageService.deleteObject(bucket, bucketKey);
      }
      
      res.status(201).json({
        ...document,
        linkId: link.id,
        documentType: link.documentType
      });
    } catch (error) {
      next(error);
    }
  });

  // List documents for entity
  app.get("/api/task-ledger-documents", requireAuth, async (req, res, next) => {
    try {
      const { entityType, entityId } = req.query;
      const userId = req.user!.id;
      
      if (!entityType || typeof entityType !== 'string') {
        return res.status(400).json({ error: 'entityType query param is required' });
      }
      if (!entityId || typeof entityId !== 'string' || !isUuid(entityId)) {
        return res.status(400).json({ error: 'entityId must be a valid UUID' });
      }
      
      // Use user's orgId with strict environment check
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      const documents = await storage.getTaskLedgerDocumentsByEntity(orgId, entityType, entityId);
      res.json(documents);
    } catch (error) {
      next(error);
    }
  });

  // Get signed download URL for document
  app.get("/api/task-ledger-documents/:documentId/signed-url", requireAuth, async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const userId = req.user!.id;
      
      if (!isUuid(documentId)) {
        return res.status(400).json({ error: 'documentId must be a valid UUID' });
      }
      
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      const document = await storage.getTaskLedgerDocument(documentId, orgId);
      if (!document || document.pendingDelete) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      const bucket = process.env.S3_DOCUMENT_BUCKET || "documents";
      
      // Get signed download URL using S3
      const url = await objectStorageService.getDownloadURL(bucket, document.bucketKey);
      res.json({ url });
    } catch (error) {
      next(error);
    }
  });

  // Get bulk signed download URLs for multiple documents
  app.post("/api/task-ledger-documents/bulk-signed-urls", requireAuth, async (req, res, next) => {
    try {
      const { documentIds } = req.body;
      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ error: 'documentIds must be a non-empty array' });
      }
      if (documentIds.length > 50) {
        return res.status(400).json({ error: 'Cannot request more than 50 signed URLs at once' });
      }
      for (const id of documentIds) {
        if (!isUuid(id)) {
          return res.status(400).json({ error: `Invalid document ID: ${id}` });
        }
      }

      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }

      const bucket = process.env.S3_DOCUMENT_BUCKET || "documents";

      const results = await Promise.all(
        documentIds.map(async (documentId: string) => {
          const document = await storage.getTaskLedgerDocument(documentId, orgId);
          if (!document || document.pendingDelete) {
            return { documentId, url: null, originalName: null, error: 'Not found' };
          }
          try {
            const url = await objectStorageService.getDownloadURL(bucket, document.bucketKey);
            return { documentId, url, originalName: document.originalName };
          } catch {
            return { documentId, url: null, originalName: document.originalName, error: 'Failed to generate URL' };
          }
        })
      );

      res.json({ results });
    } catch (error) {
      next(error);
    }
  });

  // Get signed preview URL for document (10 minute expiry)
  app.get("/api/task-ledger-documents/:documentId/preview-url", requireAuth, async (req, res, next) => {
    try {
      const { documentId } = req.params;
      const userId = req.user!.id;
      
      if (!isUuid(documentId)) {
        return res.status(400).json({ error: 'documentId must be a valid UUID' });
      }
      
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      const document = await storage.getTaskLedgerDocument(documentId, orgId);
      if (!document || document.pendingDelete) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      const bucket = getTaskLedgerBucket();
      
      // Get signed preview URL using S3 (10 minute expiry)
      console.log(`[PREVIEW_DEBUG] Generating preview URL. Bucket: "${bucket}", Key: "${document.bucketKey}", DocId: "${documentId}", OrgId: "${orgId}"`);
      const signedUrl = await objectStorageService.getPreviewURL(bucket, document.bucketKey);
      res.json({ signedUrl, expiresIn: 600 });
    } catch (error) {
      next(error);
    }
  });

  // Delete task ledger document link (removes link only, not the document file unless unlinked)
  app.delete("/api/task-ledger-document-links/:linkId", requireAuth, async (req, res, next) => {
    try {
      const { linkId } = req.params;
      
      if (!isUuid(linkId)) {
        return res.status(400).json({ error: 'linkId must be a valid UUID' });
      }
      
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }

      // Atomic unlink and evaluation
      const { remainingLinks, documentId, bucketKey } = await storage.unlinkTaskLedgerDocumentAtomic(linkId, orgId);
      
      if (remainingLinks === -1) {
        // Idempotent: return success even if not found
        return res.json({ ok: true, notes: "Link not found, already deleted?" });
      }
      
      let storageDeleted = false;
      let docDeleted = false;
      
      if (remainingLinks === 0 && documentId) {
        // 3) No more links, delete from storage strictly
        let pathToDelete = bucketKey;
        
        // Fallback: if bucketKey missing from atomic (dangling link), try to fetch the document
        if (!pathToDelete) {
          const doc = await storage.getTaskLedgerDocument(documentId, orgId);
          if (doc?.bucketKey) {
            pathToDelete = doc.bucketKey;
          }
        }
        
        if (pathToDelete) {
          const bucket = process.env.S3_DOCUMENT_BUCKET || "documents";
          storageDeleted = await objectStorageService.deleteObjectStrict(bucket, pathToDelete);
          
          if (storageDeleted) {
            // Only hard-delete DB row if storage deletion succeeded or object wasn't found
            await storage.deleteTaskLedgerDocument(documentId, orgId);
            docDeleted = true;
          } else {
            console.warn(`Storage delete failed for document ${documentId}. Record remains as pending_delete=true.`);
          }
        } else {
          // NEVER hard-delete DB metadata if we don't have a path to verify/delete in storage.
          // This prevents orphaning storage files. The record remains as pendingDelete.
          console.error(`Cannot safely delete metadata for ${documentId}: bucketKey is missing.`);
          await storage.updateTaskLedgerDocument(documentId, orgId, { pendingDelete: true });
        }
      }
      
      res.json({ 
        ok: true, 
        remainingLinks, 
        storageDeleted, 
        docDeleted,
        notes: docDeleted ? "Document fully removed (no links remain)" : "Link removed, document preserved (other links exist or storage delete failed)"
      });
    } catch (error) {
      next(error);
    }
  });

  // Delete task ledger document
  app.delete("/api/task-ledger-documents/:documentId", requireAuth, async (req, res, next) => {
    try {
      const { documentId } = req.params;
      
      if (!isUuid(documentId)) {
        return res.status(400).json({ error: 'documentId must be a UUID' });
      }
      
      let orgId: string;
      try {
        orgId = getEffectiveOrgId(req);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }

      const document = await storage.getTaskLedgerDocument(documentId, orgId);
      if (!document || document.pendingDelete) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      // Mark as pending_delete first (soft-delete) to prevent listing/access
      await storage.updateTaskLedgerDocument(documentId, orgId, { pendingDelete: true });
      
      // Delete from storage strictly
      const bucket = process.env.S3_DOCUMENT_BUCKET || "documents";
      const storageDeleted = await objectStorageService.deleteObjectStrict(bucket, document.bucketKey);
      
      if (storageDeleted) {
        // Only hard-delete DB row if storage deletion succeeded or object wasn't found
        await storage.deleteTaskLedgerDocument(documentId, orgId);
        res.sendStatus(204);
      } else {
        res.status(500).json({ 
          error: 'Failed to delete storage object. DB record marked as pending delete and will be cleaned up by background job.',
          storageDeleted: false
        });
      }
    } catch (error) {
      next(error);
    }
  });

  // Dashboard Stats API
  app.get("/api/dashboard/stats", requireAuth, async (req, res, next) => {
    try {
      const stats = await storage.getDashboardStats(req.user!.id);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // Calendar API
  // ⭐ Contract: start/end are YYYY-MM-DD strings, INCLUSIVE in IST timezone
  app.get("/api/calendar/items", requireAuth, async (req, res, next) => {
    try {
      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ message: "start and end dates are required" });
      }

      // ⭐ Use canonical range parser (covers full IST days, end is inclusive)
      const [startDate, endDate] = parseCalendarRange(start as string, end as string);

      const items = await storage.getCalendarItems(req.user!.id, startDate, endDate);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  // Tasks API - for Task View (Aggregates all items from different tables)
  app.get("/api/tasks", requireAuth, async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const tab = (req.query.tab as string) || "upcoming";
      const kind = (req.query.kind as string) || "all";
      const monthParam = (req.query.month as string) || "all";
      const sort = (req.query.sort as string) || "dueDate";
      const todayYmd = getTodayYmdIST();

      // Build entity type filter
      const types = kindToEntityTypes(kind);
      const typeCond =
        types.length === 0
          ? sql`1=1`
          : types.length === 1
            ? sql`entity_type = ${types[0]}`
            : sql`entity_type in (${sql.join(types.map(t => sql`${t}`), sql`, `)})`;

      // Build month filter
      let monthCond = sql`1=1`;
      if (monthParam !== "all") {
        const parsedMonth = parseMonthParam(monthParam);
        if (parsedMonth) {
          const { fromYmd, toYmdExclusive } = monthToRange(parsedMonth);
          monthCond = sql`due_date_local_ymd >= ${fromYmd} AND due_date_local_ymd < ${toYmdExclusive}`;
        }
      }

      // Build tab filter condition for WHERE clause in outer query
      let tabWhereCond = sql`1=1`;
      if (tab === "today") tabWhereCond = sql`pending_rows > 0 AND due_date_local_ymd = ${todayYmd}`;
      else if (tab === "upcoming") tabWhereCond = sql`pending_rows > 0 AND due_date_local_ymd > ${todayYmd}`;
      else if (tab === "overdue") tabWhereCond = sql`pending_rows > 0 AND due_date_local_ymd < ${todayYmd}`;
      else if (tab === "completed") tabWhereCond = sql`pending_rows = 0`;

      // Build ORDER BY
      let orderBy = sql`due_date_local_ymd, due_date_iso`;
      if (sort === "category") orderBy = sql`category NULLS LAST, due_date_local_ymd`;
      else if (sort === "priority") {
        orderBy = sql`
          CASE
            WHEN due_date_local_ymd < ${todayYmd} THEN 1
            WHEN due_date_local_ymd = ${todayYmd} THEN 2
            ELSE 3
          END,
          due_date_local_ymd
        `;
      }

      // Use CTE to compute pending_rows, then filter in outer query
      const finalQuery = sql`
        WITH grouped_tasks AS (
          SELECT
            occurrence_key,
            due_date_local_ymd,
            MIN(entity_type) as entity_type,
            (MIN(entity_id::text))::uuid as entity_id,
            MAX(task_title) as title,
            MAX(task_note) as note,
            MIN(occurrence_task_utc) as due_date_iso,
            MAX(completed_at) as completed_at,
            SUM(CASE WHEN task_status = 'pending' THEN 1 ELSE 0 END)::int as pending_rows
          FROM occurrence_reminders
          WHERE user_id = ${userId}
            AND ${typeCond}
            AND ${monthCond}
          GROUP BY occurrence_key, due_date_local_ymd
        )
        SELECT * FROM grouped_tasks
        WHERE ${tabWhereCond}
        ORDER BY ${orderBy}
      `;

      const result = await (storage as any).dbx.execute(finalQuery);
      const rows = (result as any).rows ?? result ?? [];
      
      console.log(`✅ /api/tasks returned ${rows.length} tasks (tab=${tab}, kind=${kind}, month=${monthParam})`);

      res.json(
        rows.map((r: any) => {
          // Compute priority based on due date
          let priority: 'low' | 'medium' | 'high' = 'low';
          if (r.pending_rows > 0) {
            if (r.due_date_local_ymd < todayYmd) {
              priority = 'high'; // Overdue
            } else if (r.due_date_local_ymd === todayYmd) {
              priority = 'high'; // Due today
            } else {
              // Calculate days until due
              const dueDate = new Date(r.due_date_local_ymd + 'T00:00:00Z');
              const today = new Date(todayYmd + 'T00:00:00Z');
              const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              if (daysUntil <= 7) priority = 'high';
              else if (daysUntil <= 30) priority = 'medium';
              else priority = 'low';
            }
          }

          const uiEntityType = mapDbEntityToUi(r.entity_type);
          const displayStatus: 'pending' | 'completed' | 'overdue' = 
            r.pending_rows > 0 ? (r.due_date_local_ymd < todayYmd ? 'overdue' : 'pending') : 'completed';

          return {
            id: r.occurrence_key,
            occurrenceKey: r.occurrence_key,
            entityType: uiEntityType,
            entityId: r.entity_id,
            title: r.title ?? "Untitled Task",
            description: r.note ?? null,
            category: r.category ?? "General",
            dueDate: r.due_date_iso ?? `${r.due_date_local_ymd}T00:00:00.000Z`,
            status: displayStatus,
            priority,
            entityName: r.title || uiEntityType.charAt(0).toUpperCase() + uiEntityType.slice(1),
            tags: []
          };
        })
      );
    } catch (error) {
      next(error);
    }
  });

  // Task counts endpoint for dashboard tabs
  app.get("/api/tasks/counts", requireAuth, async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const kind = (req.query.kind as string) || "all";
      const monthParam = (req.query.month as string) || "all";
      const todayYmd = getTodayYmdIST();

      // Build entity type filter
      const types = kindToEntityTypes(kind);
      const typeCond =
        types.length === 0
          ? sql`1=1`
          : types.length === 1
            ? sql`entity_type = ${types[0]}`
            : sql`entity_type in (${sql.join(types.map(t => sql`${t}`), sql`, `)})`;

      // Build month filter
      let monthCond = sql`1=1`;
      if (monthParam !== "all") {
        const parsedMonth = parseMonthParam(monthParam);
        if (parsedMonth) {
          const { fromYmd, toYmdExclusive } = monthToRange(parsedMonth);
          monthCond = sql`due_date_local_ymd >= ${fromYmd} AND due_date_local_ymd < ${toYmdExclusive}`;
        }
      }

      // Build CTE with same logic as /api/tasks
      const q = sql`
        WITH occurrence_groups AS (
          SELECT
            occurrence_key,
            due_date_local_ymd,
            SUM(CASE WHEN task_status = 'pending' THEN 1 ELSE 0 END)::int as pending_rows
          FROM occurrence_reminders
          WHERE user_id = ${userId}
            AND ${typeCond}
            AND ${monthCond}
          GROUP BY occurrence_key, due_date_local_ymd
        )
        SELECT
          SUM(CASE WHEN pending_rows > 0 AND due_date_local_ymd = ${todayYmd} THEN 1 ELSE 0 END)::int as today,
          SUM(CASE WHEN pending_rows > 0 AND due_date_local_ymd > ${todayYmd} THEN 1 ELSE 0 END)::int as upcoming,
          SUM(CASE WHEN pending_rows > 0 AND due_date_local_ymd < ${todayYmd} THEN 1 ELSE 0 END)::int as overdue,
          SUM(CASE WHEN pending_rows = 0 THEN 1 ELSE 0 END)::int as completed
        FROM occurrence_groups
      `;

      const result = await (storage as any).dbx.execute(q);
      const row = (result as any).rows?.[0] ?? (result as any)[0] ?? {};

      const counts = {
        today: Number(row.today ?? 0),
        upcoming: Number(row.upcoming ?? 0),
        overdue: Number(row.overdue ?? 0),
        completed: Number(row.completed ?? 0),
      };
      
      console.log(`✅ /api/tasks/counts (kind=${kind}, month=${monthParam}):`, counts);

      res.json(counts);
    } catch (error) {
      next(error);
    }
  });

  // Upcoming due dates API - Uses occurrence_reminders as source of truth
  app.get("/api/dashboard/upcoming-due-dates", requireAuth, async (req, res, next) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const userId = req.user!.id;

      const [upcoming, overdue] = await Promise.all([
        storage.getUpcomingDueItems(userId, days),
        storage.getOverdueDueItems(userId),
      ]);

      res.json({ upcoming, overdue });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Get occurrence reminders from DB for a specific entity (paginated, server-grouped)
   * Returns grouped occurrences (one per occurrence_key) with pagination metadata
   * 
   * Query params:
   * - from: ISO date (optional, default: today - 180 days)
   * - to: ISO date (optional, default: today + 365 days)
   * - limit: max occurrences to return (default: 10, max: 50)
   * - cursor: opaque pagination cursor (optional)
   * - direction: "next" | "prev" (default: "next")
   */
  app.get("/api/task-occurrences/entity/:entityType/:entityId", requireAuth, async (req, res, next) => {
    try {
      const { entityType, entityId } = req.params;
      let { limit } = req.query;
      
      // Validate parameters
      if (!entityType || !entityId) {
        return res.status(400).json({ 
          message: "Invalid parameters: entityType and entityId are required" 
        });
      }

      const ownsEntity = await verifyEntityOwnership(entityType, entityId, req.user!.id);
      if (!ownsEntity) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Force "fetch all" with hard cap
      const HARD_CAP = 500;
      const parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : HARD_CAP;
      const finalLimit = Math.min(parsedLimit || HARD_CAP, HARD_CAP);

      console.log(`📋 Fetching ALL occurrence reminders for ${entityType}:${entityId} (limit: ${finalLimit})`);
      
      const result = await storage.getOccurrenceRemindersByEntity({
        userId: req.user!.id,
        entityType,
        entityId,
        from: undefined,
        to: undefined,
        limit: finalLimit,
        cursor: undefined,
        direction: 'next',
        fetchAll: true,
      });
      
      console.log(`   ✅ Found ${result.items.length} occurrence(s)`);
      res.json(result);
    } catch (error) {
      console.error('❌ Error fetching occurrence reminders:', error);
      next(error);
    }
  });

  // Manual trigger for reminder processing (admin/testing)
  app.post("/api/admin/trigger-reminders", requireAuth, async (req, res, next) => {
    try {
      const { runReminderSchedulerOnce } = await import("./reminder-scheduler");
      await runReminderSchedulerOnce();
      res.json({ ok: true, message: "Reminder scheduler run complete" });
    } catch (error) {
      next(error);
    }
  });

  // Send a test email to verify email provider is working
  app.post("/api/admin/test-email", requireAuth, async (req, res, next) => {
    try {
      const user = req.user!;
      const toEmail = (req.body as any).email || (user as any).email;
      if (!toEmail) {
        return res.status(400).json({ message: "No email address available" });
      }
      const sent = await emailService.sendEmail({
        to: toEmail,
        subject: "Task Ledger — Email Test",
        text: "This is a test email from Task Ledger to confirm email notifications are working.",
        html: `<p>This is a test email from <strong>Task Ledger</strong> to confirm email notifications are working correctly.</p>`,
      });
      if (sent) {
        res.json({
          ok: true,
          message: `Test email sent to ${toEmail}`,
          provider: emailTransport.getProviderName(),
          from: emailTransport.getFromEmail(),
        });
      } else {
        res.status(500).json({ ok: false, message: "Email provider not configured or send failed" });
      }
    } catch (error) {
      next(error);
    }
  });

  // Email provider health check
  app.get("/api/admin/email-status", requireAuth, async (_req, res) => {
    res.json({
      provider: emailTransport.getProviderName(),
      ready: emailTransport.isReady(),
      fromEmail: emailTransport.getFromEmail(),
      fromName: process.env.SMTP_FROM_NAME || "Task Ledger",
      lastSendAt: emailTransport.getLastSendAt(),
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}
