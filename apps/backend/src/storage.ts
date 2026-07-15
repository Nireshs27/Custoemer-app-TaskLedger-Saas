import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import crypto from "node:crypto";
import { ObjectStorageService, buildTaskLedgerObjectKey, getTaskLedgerBucket } from "./objectStorage";
import {
  taskledgerUsers,
  properties,
  taxLegalCompliances,
  taxLegalItems,
  vehicles,
  vehicleItems,
  assets,
  assetItems,
  taskActionItems,
  taskLedgerDocuments,
  taskLedgerDocumentLinks,
  occurrenceReminders,
  taskActions,
  calendarEvents,
  hrEmployees,
  hrEmployeePhotos,
  type TaskLedgerUser,
  type InsertTaskLedgerUser,
  type Property,
  type InsertProperty,
  type TaxLegalCompliance,
  type InsertTaxLegalCompliance,
  type TaxLegalItem,
  type InsertTaxLegalItem,
  type Vehicle,
  type InsertVehicle,
  type VehicleItem,
  type InsertVehicleItem,
  type Asset,
  type InsertAsset,
  type AssetItem,
  type InsertAssetItem,
  type TaskActionItem,
  type InsertTaskActionItem,
  type TaskLedgerDocument,
  type InsertTaskLedgerDocument,
  type TaskLedgerDocumentLink,
  type InsertTaskLedgerDocumentLink,
  type SelectTaskAction,
  type InsertTaskAction,
  type SelectCalendarEvent,
  type InsertCalendarEvent,
  type OccurrenceReminder,
  type InsertOccurrenceReminder,
} from "@shared/schema";
import { computeInitialNextDueDate, computeNextDueDateAfterCompletion } from "./lib/next-due-date";
import {
  eq,
  desc,
  asc,
  and,
  gte,
  lte,
  lt,
  gt,
  or,
  like,
  sql,
  inArray,
  ilike,
  isNull,
  SQL,
} from "drizzle-orm";
import {
  expandCalendarItemsForRange,
  type CalendarItemWithOccurrences,
  type CalendarBaseItem,
  type RecurrenceData as ExpanderRecurrenceData,
} from "./lib/calendar-recurrence-expander";
import {
  computeScheduleAfterSuccessfulSend,
  validateReminderScheduleInvariants,
} from "./reminder-schedule-utils";
import {
  ReminderOffsetUnit,
  REMINDER_OFFSET_UNITS,
  type ReminderScheduleRecord,
} from "@shared/reminders-spec";
import { type RecurrenceMonthlyOrdinal } from "@shared/recurrence-constants";
import {
  MANUAL_PERMANENT_FAILURE_ERROR_TYPE,
  MISSED_REMINDER_MAX_ATTEMPTS,
  RETRYABLE_REMINDER_ERROR_TYPES,
} from "./reminderConstants";
import { getTodayYmdIST } from "./lib/task-filters";
import { recurrenceDataSchema } from "@shared/recurrence-validation";
import { istDateTimeToUtc } from "./utils/timezone";
import { toISTDateString } from "./lib/calendar-range";
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const DEFAULT_REMINDER_OFFSET_VALUE = 7;

export interface DatabaseStorageOptions {
  connectionString?: string;
  skipInit?: boolean;
}

export function normalizeReminderOffset(
  rawValue?: number | null,
  rawUnit?: string | null,
  fallbackDays?: number | null
): { value: number; unit: ReminderOffsetUnit } {
  const numericValue =
    typeof rawValue === "number" && !Number.isNaN(rawValue)
      ? rawValue
      : typeof fallbackDays === "number" && !Number.isNaN(fallbackDays)
      ? fallbackDays
      : DEFAULT_REMINDER_OFFSET_VALUE;

  const normalizedUnit: ReminderOffsetUnit =
    rawUnit && REMINDER_OFFSET_UNITS.includes(rawUnit as ReminderOffsetUnit)
      ? (rawUnit as ReminderOffsetUnit)
      : "days";

  return {
    value: Math.max(1, Math.round(numericValue)),
    unit: normalizedUnit,
  };
}

export function convertOffsetToDays(
  value: number,
  unit: ReminderOffsetUnit
): number {
  if (unit === "minutes") {
    return value / MINUTES_PER_DAY;
  }
  if (unit === "hours") {
    return (value * MINUTES_PER_HOUR) / MINUTES_PER_DAY;
  }
  return value;
}

export function applyReminderOffset(
  baseDate: Date,
  value: number,
  unit: ReminderOffsetUnit
): Date {
  const date = new Date(baseDate);
  if (unit === "minutes") {
    date.setMinutes(date.getMinutes() - value);
  } else if (unit === "hours") {
    date.setHours(date.getHours() - value);
  } else {
    date.setDate(date.getDate() - value);
  }
  return date;
}

export function applyReminderTime(date: Date, timeValue?: string | null): void {
  if (!timeValue || typeof timeValue !== "string" || !timeValue.includes(":")) {
    return;
  }

  const [hours, minutes] = timeValue.split(":").map(Number);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return;
  }

  // Interpret `timeValue` as IST on the same local calendar date as `date`.
  // 1) Shift input date to IST to grab the date portion.
  // 2) Build a UTC instant for that IST date + timeValue.
  // 3) Set the original Date to that UTC instant.
  const istShifted = new Date(
    date.getTime() + (5 * 60 + 30) * 60 * 1000
  );
  const istDatePart = istShifted.toISOString().split("T")[0];
  const utcDate = istDateTimeToUtc(istDatePart, timeValue);
  date.setTime(utcDate.getTime());
}

export function makeOccurrenceKey(entityId: string, occurrenceTaskUtc: Date): string {
  return `${entityId}::${occurrenceTaskUtc.toISOString()}`;
}

export function toLocalYmdIST(dateUtc: Date): string {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(dateUtc.getTime() + IST_OFFSET_MS);
  return istDate.toISOString().split('T')[0];
}

export function computeOccurrenceTaskUtcFromEntity(
  dueDateYmd: string,
  reminderTimes: string[]
): Date {
  const taskTime = (reminderTimes && reminderTimes.length > 0) ? reminderTimes[0] : '09:00';
  const dateObj = new Date(dueDateYmd);
  const [hours, minutes] = taskTime.split(':').map(Number);
  
  // Convert IST to UTC (IST = UTC + 5:30)
  let utcHours = hours - 5;
  let utcMinutes = minutes - 30;
  
  if (utcMinutes < 0) {
    utcMinutes += 60;
    utcHours -= 1;
  }
  
  if (utcHours < 0) {
    utcHours += 24;
    dateObj.setDate(dateObj.getDate() - 1);
  }
  
  dateObj.setUTCHours(utcHours, utcMinutes, 0, 0);
  return dateObj;
}

export function computeReminderAtUtc(
  occurrenceTaskUtc: Date,
  offsetValue: number,
  offsetUnit: string,
  reminderTimes: string[]
): Date {
  const normalized = normalizeReminderOffset(offsetValue, offsetUnit, undefined);
  const reminderDate = applyReminderOffset(occurrenceTaskUtc, normalized.value, normalized.unit);
  
  const taskTime = (reminderTimes && reminderTimes.length > 0) ? reminderTimes[0] : '09:00';
  const reminderTime = (reminderTimes && reminderTimes.length > 1 && reminderTimes[1]) 
    ? reminderTimes[1] 
    : taskTime;
  
  applyReminderTime(reminderDate, reminderTime);
  return reminderDate;
}

function parseJsonbStringArray(field: unknown): string[] {
  const normalize = (arr: unknown[]): string[] =>
    arr
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

  if (Array.isArray(field)) {
    return normalize(field);
  }

  if (typeof field === "string") {
    try {
      const parsed = JSON.parse(field);
      if (Array.isArray(parsed)) {
        return normalize(parsed);
      }
    } catch {
      return [];
    }
  }

  return [];
}

type CalendarQueryRowRaw = {
  id: string;
  title: string;
  dueDate: Date | string;
  category: string | null;
  status: string;
  entityType: "tax" | "vehicle" | "asset" | "event" | "task_action_item" | "tax_legal_item";
  vehicleId: string | null;
  vehicleName: string | null;
  recurrenceData: unknown;
};

const parseRecurrenceDataSafe = (
  raw: unknown
): ExpanderRecurrenceData | null => {
  if (!raw) return null;
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const normalized = normalizeMonthlyLegacy(candidate);
  const parsed = recurrenceDataSchema.safeParse(normalized);
  if (!parsed.success) {
    return null;
  }
  return parsed.data as ExpanderRecurrenceData;
};

const normalizeMonthlyLegacy = (candidate: any) => {
  if (!candidate || typeof candidate !== "object") return candidate;

  const monthlyType = (candidate as any).monthlyType;
  const isOrdinalType = monthlyType === "ordinal" || monthlyType === "day";
  if (!isOrdinalType) return candidate;

  const startDateValue = (candidate as any).startDate;
  const startDate =
    startDateValue && !Number.isNaN(new Date(startDateValue).getTime())
      ? new Date(startDateValue)
      : undefined;

  const weekdayProvided = (candidate as any).monthlyWeekday;
  const weekday =
    typeof weekdayProvided === "number"
      ? weekdayProvided
      : startDate
      ? startDate.getDay()
      : undefined;

  const ordinalProvided = (candidate as any).monthlyOrdinal;
  const ordinal =
    typeof ordinalProvided === "string"
      ? ordinalProvided
      : startDate && typeof weekday === "number"
      ? deriveOrdinalFromDate(startDate, weekday)
      : undefined;

  // Only add missing fields; never override existing values
  const next = { ...candidate };
  if (typeof next.monthlyWeekday !== "number" && typeof weekday === "number") {
    next.monthlyWeekday = weekday;
  }
  if (!next.monthlyOrdinal && ordinal) {
    next.monthlyOrdinal = ordinal;
  }
  return next;
};

const deriveOrdinalFromDate = (
  date: Date,
  weekday: number
): RecurrenceMonthlyOrdinal => {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = getDaysInMonth(year, month);

  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const firstOccurrenceDate = 1 + offset;

  const occurrenceIndex = Math.floor((date.getDate() - firstOccurrenceDate) / 7) + 1;
  const willExceedMonth = date.getDate() + 7 > daysInMonth;

  if (willExceedMonth) return "last";

  const ordinalMap: RecurrenceMonthlyOrdinal[] = [
    "first",
    "second",
    "third",
    "fourth",
  ];
  return ordinalMap[Math.max(0, Math.min(ordinalMap.length - 1, occurrenceIndex - 1))];
};

const getDaysInMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

const normalizeTaskTitleValue = (value: string | null | undefined): string =>
  (value ?? "").trim();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReminderIssueQueryRow = {
  issue_key: string;
  history_id: string;
  reminder_id: string | null;
  user_id: string;
  entity_type: string;
  entity_id: string;
  task_title: string | null;
  recipient_email: string | null;
  reminder_date: Date | string | null;
  schedule_type: string | null;
  occurrence_number: number | null;
  email_subject: string | null;
  derived_status: ReminderIssueStatus;
  last_attempt_at: Date | string | null;
  first_failed_at: Date | string | null;
  failure_count: number | null;
  total_attempts: number | null;
  attempt_count: number | null;
  error_type: string | null;
  error_message: string | null;
};

type ReminderHistoryUpsertInput = {
  reminderId: string | null;
  userId: string;
  entityType: string;
  entityId: string;
  taskTitle: string | null;
  reminderDate: Date | string;
  recipientEmail: string;
  scheduleType: string | null;
  occurrenceNumber: number;
  status: string;
  errorType?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  attemptedAt: Date | string;
  emailSubject?: string | null;
  attemptCount?: number;
  acknowledgedByUser?: boolean;
};

type ScheduleAdvanceOptions = {
  attemptTime?: Date;
  didSucceed?: boolean;
};

const NORMALIZED_SENT_STATUSES = new Set(["sent", "sent_after_retry"]);
const FAILURE_STATUSES = new Set(["failed"]);
const MAX_RETRY_ATTEMPTS = 50;
const MIN_RETRY_COOLDOWN_MIN = 0;

const normalizeHistoryStatus = (
  status: string | null | undefined
): "sent" | "failed" => {
  if (!status) {
    return "failed";
  }
  const normalized = status.toLowerCase();
  return NORMALIZED_SENT_STATUSES.has(normalized) ? "sent" : "failed";
};

const deriveAggregateStatusFromRecipients = (
  recipients: RecipientDeliveryStatus[]
): "pending" | "sent" | "failed" | "partial" => {
  if (recipients.length === 0) {
    return "pending";
  }
  const statuses = recipients.map((recipient) => recipient.status);
  if (statuses.every((status) => status === "pending")) {
    return "pending";
  }
  if (statuses.every((status) => status === "sent")) {
    return "sent";
  }
  if (statuses.every((status) => status === "failed")) {
    return "failed";
  }
  return "partial";
};

const findLatestAttemptTimestamp = (
  recipients: RecipientDeliveryStatus[]
): string | null => {
  const latest = recipients.reduce<number | null>((acc, recipient) => {
    if (!recipient.attemptedAt) {
      return acc;
    }
    const ts = new Date(recipient.attemptedAt).getTime();
    if (Number.isNaN(ts)) {
      return acc;
    }
    if (acc === null || ts > acc) {
      return ts;
    }
    return acc;
  }, null);

  return typeof latest === "number" ? new Date(latest).toISOString() : null;
};

export type RecipientDeliveryStatus = {
  recipientEmail: string;
  status: "sent" | "failed" | "pending" | "expired" | "sending";
  attemptedAt: string | null;
  errorType: string | null;
  errorMessage: string | null;
};

export type ReminderOccurrenceDelivery = {
  reminderId: string | null;
  entityId: string;
  entityType: string;
  scheduleType: string | null;
  occurrenceNumber: number;
  reminderDate: string | null;
  taskDate: string | null;
  calculatedReminderDate: string | null;
  calculatedTaskDate: string | null;
  recipientStatuses: RecipientDeliveryStatus[];
  aggregateStatus: "pending" | "sent" | "failed" | "partial" | "expired" | "sending";
  aggregateStatusChangedAt: string | null;
};

export type MissedReminderDTO = {
  reminderId: string;
  occurrenceNumber: number;
  recipientEmail: string;
  userId: string;
  entityType: string;
  entityId: string;
  taskTitle: string | null;
  taskCategory: string | null;
  scheduleType: string | null;
  reminderDateUtc: string | null;
  attemptedAtUtc: string | null;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  emailSubject: string | null;
  acknowledgedByUser?: boolean;
};

type LatestReminderHistoryRow = {
  reminder_id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  task_title: string | null;
  schedule_type: string | null;
  occurrence_number: number | null;
  recipient_email: string;
  reminder_date: string | Date | null;
  attempted_at: string | Date | null;
  status: string | null;
  error_type: string | null;
  error_message: string | null;
  email_subject: string | null;
  attempt_count: number | null;
  acknowledged_by_user: boolean | null;
  row_rank: number;
};

const PostgreSqlStore = ConnectPgSimple(session);

export interface IStorage {
  // TaskLedger User management (taskledger_users)
  getTaskLedgerUser(id: string): Promise<TaskLedgerUser | undefined>;
  getTaskLedgerUserByUsername(username: string): Promise<TaskLedgerUser | undefined>;
  getTaskLedgerUserByEmail(email: string): Promise<TaskLedgerUser | undefined>;
  createTaskLedgerUser(user: InsertTaskLedgerUser): Promise<TaskLedgerUser>;
  updateTaskLedgerUser(id: string, updates: Partial<InsertTaskLedgerUser>): Promise<TaskLedgerUser>;
  updateTaskLedgerUserLastLogin(id: string): Promise<void>;
  deleteTaskLedgerUser(id: string): Promise<void>;
  getAllTaskLedgerUsers(): Promise<TaskLedgerUser[]>;

  // HR Employees
  getHrEmployees(firmId: string): Promise<any[]>;

  // Properties
  getProperty(id: string): Promise<Property | undefined>;
  getPropertiesByUser(userId: string): Promise<Property[]>;
  createProperty(property: InsertProperty): Promise<Property>;
  updateProperty(userId: string, id: string, updates: Partial<InsertProperty>): Promise<Property>;
  deleteProperty(userId: string, id: string): Promise<void>;

  // Tax & Legal Compliance (NEW MODULE)
  getTaxLegalCompliance(id: string): Promise<TaxLegalCompliance | undefined>;
  listTaxLegalCompliancesByUser(userId: string): Promise<TaxLegalCompliance[]>;
  createTaxLegalCompliance(input: InsertTaxLegalCompliance): Promise<TaxLegalCompliance>;
  updateTaxLegalCompliance(id: string, updates: Partial<InsertTaxLegalCompliance>): Promise<TaxLegalCompliance>;
  deleteTaxLegalCompliance(id: string): Promise<void>;

  getTaxLegalItem(id: string): Promise<TaxLegalItem | undefined>;
  listTaxLegalItemsByCompliance(complianceId: string): Promise<TaxLegalItem[]>;
  createTaxLegalItem(input: InsertTaxLegalItem): Promise<TaxLegalItem>;
  updateTaxLegalItem(id: string, updates: Partial<InsertTaxLegalItem>): Promise<TaxLegalItem>;
  deleteTaxLegalItem(id: string): Promise<void>;

  // Vehicles
  getVehicle(id: string): Promise<Vehicle | undefined>;
  getVehiclesByUser(userId: string): Promise<Vehicle[]>;
  createVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  updateVehicle(id: string, updates: Partial<InsertVehicle>): Promise<Vehicle>;
  deleteVehicle(id: string): Promise<void>;

  // Vehicle Items - Enhanced with same advanced features as Tax Items
  getVehicleItem(id: string): Promise<VehicleItem | undefined>;
  getVehicleItemsByUser(userId: string): Promise<VehicleItem[]>;
  getVehicleItemsByVehicle(vehicleId: string): Promise<VehicleItem[]>;
  createVehicleItem(item: InsertVehicleItem): Promise<VehicleItem>;
  updateVehicleItem(id: string, updates: Partial<InsertVehicleItem>): Promise<VehicleItem>;
  deleteVehicleItem(id: string): Promise<void>;
  getUpcomingVehicleItems(userId: string, days: number): Promise<VehicleItem[]>;
  getOverdueVehicleItems(userId: string): Promise<VehicleItem[]>;

  // Assets
  getAsset(id: string): Promise<Asset | undefined>;
  getAssetsByUser(userId: string): Promise<Asset[]>;
  createAsset(asset: InsertAsset): Promise<Asset>;
  updateAsset(id: string, updates: Partial<InsertAsset>): Promise<Asset>;
  deleteAsset(id: string): Promise<void>;

  // Asset Items
  getAssetItem(id: string): Promise<AssetItem | undefined>;
  getAssetItemsByUser(userId: string): Promise<AssetItem[]>;
  getAssetItemsByAsset(assetId: string): Promise<AssetItem[]>;
  createAssetItem(item: InsertAssetItem): Promise<AssetItem>;
  updateAssetItem(id: string, updates: Partial<InsertAssetItem>): Promise<AssetItem>;
  deleteAssetItem(id: string): Promise<void>;

  // Task Ledger Documents (new normalized structure)
  upsertTaskLedgerDocumentAndLinkFromUpload(params: {
    orgId: string,
    userId: string,
    entityType: string,
    entityId: string,
    documentType?: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    fileBuffer: Buffer
  }): Promise<{ document: TaskLedgerDocument, link: TaskLedgerDocumentLink }>;
  createTaskLedgerDocument(document: InsertTaskLedgerDocument): Promise<TaskLedgerDocument>;
  getTaskLedgerDocument(id: string, orgId: string): Promise<TaskLedgerDocument | undefined>;
  updateTaskLedgerDocument(id: string, orgId: string, updates: Partial<TaskLedgerDocument>): Promise<TaskLedgerDocument>;
  deleteTaskLedgerDocument(id: string, orgId: string): Promise<void>;
  createTaskLedgerDocumentLink(link: InsertTaskLedgerDocumentLink): Promise<TaskLedgerDocumentLink>;
  getTaskLedgerDocumentsByEntity(orgId: string, entityType: string, entityId: string): Promise<Array<TaskLedgerDocument & { documentType: string | null; linkId: string }>>;
  getTaskLedgerDocumentLink(linkId: string, orgId: string): Promise<TaskLedgerDocumentLink | undefined>;
  unlinkTaskLedgerDocumentAtomic(linkId: string, orgId: string): Promise<{ remainingLinks: number; documentId?: string; bucketKey?: string }>;
  deleteTaskLedgerDocumentLink(linkId: string, orgId: string): Promise<void>;
  countTaskLedgerDocumentLinksByDocumentId(documentId: string, orgId: string): Promise<number>;

  // Dashboard stats
  getDashboardStats(userId: string): Promise<{
    overdue: number;
    thisWeek: number;
    properties: number;
    assets: number;
    vehicles: number;
  }>;

  // Dashboard due items (from occurrence_reminders)
  getUpcomingDueItems(userId: string, days: number): Promise<Array<{
    id: string;
    title: string;
    category: string;
    dueDate: string;
    status: string;
    entityType: "tax" | "vehicle" | "asset" | "action";
    entityId: string;
    occurrenceKey: string;
  }>>;
  getOverdueDueItems(userId: string): Promise<Array<{
    id: string;
    title: string;
    category: string;
    dueDate: string;
    status: string;
    entityType: "tax" | "vehicle" | "asset" | "action";
    entityId: string;
    occurrenceKey: string;
  }>>;

  // Calendar data
  getCalendarItems(userId: string, startDate: Date, endDate: Date): Promise<CalendarItemWithOccurrences[]>;
  getOccurrenceInstancesForCalendar(
    userId: string,
    startDateStr: string,
    endDateStr: string
  ): Promise<Array<{
    occurrenceKey: string;
    entityType: string;
    entityId: string;
    taskTitle: string;
    dueDateLocalYmd: string;
    occurrenceTaskUtc: Date;
    taskStatus: string;
    completedAt: Date | null;
    taskNote: string | null;
    remindersPending: number;
    remindersSent: number;
    remindersFailed: number;
    isRecurringOccurrence: boolean;
    seriesMasterId: string | null;
  }>>;

  // Task occurrence events
  getOccurrenceStatusesForEntity(
    userId: string,
    entityType: string,
    entityId: string,
    from?: string | null,
    to?: string | null
  ): Promise<
    {
      occurrence_key: string;
      status: string;
      note: string | null;
      updated_at: Date | string | null;
    }[]
  >;
  getOccurrenceCurrentStatus(
    userId: string,
    occurrenceKey: string
  ): Promise<{
    occurrenceKey: string;
    status: "completed" | "skipped" | null;
    note: string | null;
    updatedAt: string | null;
  }>;
  insertOccurrenceCompleteEvent(params: {
    userId: string;
    reminderScheduleId: string;
    occurrenceKey: string;
    occurrenceTaskUtc: string;
    note?: string | null;
  }): Promise<{ inserted: boolean }>;

  deleteOccurrenceRemindersForEntity(args: {
    userId: string;
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item';
    entityId: string;
  }): Promise<{ deletedCount: number }>;
  getCurrentRecipientsFromOccurrenceReminders(
    userId: string,
    entityType: string,
    entityId: string
  ): Promise<string[]>;
  updateTaskMetadata(
    userId: string,
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item',
    entityId: string,
    metadata: {
      title?: string;
      contacts?: Array<{ id: string; name: string; mobile: string; designation: string | null }>;
      recipients?: string[];
    }
  ): Promise<{ updatedRemindersCount: number }>;
  updateOccurrenceReminderMetadataForEntity(args: {
    userId: string;
    entityType: string;
    entityId: string;
    title?: string;
    emailRecipients?: string[];
  }): Promise<{ updatedRows: number }>;
  markOccurrenceReminderRecipientsExpired(args: {
    userId: string;
    occurrenceReminderId: string;
    recipientKeys?: string[];
  }): Promise<{ updatedRecipients: string[] }>;
  getOpenMissedRemindersForUser(userId: string): Promise<MissedReminderDTO[]>;

  // Task Actions
  getTaskAction(id: string): Promise<SelectTaskAction | undefined>;
  getTaskActionsByUser(userId: string): Promise<SelectTaskAction[]>;
  createTaskAction(action: InsertTaskAction): Promise<SelectTaskAction>;
  updateTaskAction(id: string, updates: Partial<InsertTaskAction>): Promise<SelectTaskAction>;
  deleteTaskAction(id: string): Promise<void>;

  // Task Completion - generic method for all entities
  completeTask(entityType: 'tax_item' | 'vehicle_item' | 'asset_item' | 'task_action' | 'calendar_event' | 'task_action_item' | 'tax_legal_item', entityId: string, completionNotes: string, userId: string): Promise<void>;

  // Calendar Events (Quick Events)
  getCalendarEvent(id: string): Promise<SelectCalendarEvent | undefined>;
  getCalendarEventsByUser(userId: string): Promise<SelectCalendarEvent[]>;
  createCalendarEvent(event: InsertCalendarEvent): Promise<SelectCalendarEvent>;
  updateCalendarEvent(id: string, updates: Partial<InsertCalendarEvent>): Promise<SelectCalendarEvent>;
  deleteCalendarEvent(id: string): Promise<void>;

  sessionStore: any;
}

export class DatabaseStorage implements IStorage {
  private pool: Pool | null = null;
  private db: ReturnType<typeof drizzle> | null = null;
  public sessionStore: any = null;
  private connectionString?: string;

  public get dbx() {
    if (!this.db) {
      throw new Error("Database not initialized (this.db is null). Check SKIP_STORAGE_INIT or DB env.");
    }
    return this.db;
  }

  constructor(options: DatabaseStorageOptions = {}) {
    if (options.skipInit) {
      console.warn("⚠️ Skipping DatabaseStorage initialization (skipInit)");
      this.pool = null as unknown as Pool;
      this.db = null as unknown as ReturnType<typeof drizzle>;
      this.sessionStore = null;
      return;
    }

    const connectionString =
      options.connectionString ??
      process.env.DATABASE_URL;

    if (!connectionString) {
      console.error('❌ CRITICAL: Database URL not found!');
      console.error('Set DATABASE_URL for local PostgreSQL or AWS RDS.');
      throw new Error('Database connection string not found (DATABASE_URL).');
    }

    const sslDisabled = /sslmode=disable|ssl=false/i.test(connectionString);
    console.log('✅ Database connection configured securely using environment variables');
    console.log(sslDisabled ? '✅ SSL disabled for local PostgreSQL' : '✅ SSL enabled for PostgreSQL connection');
    console.log('✅ Connection pooling enabled for better resilience');
    console.log(`✅ Connecting to: ${connectionString.replace(/:([^:@]{8,})/g, ':****')}`); // mask password in logs

    this.connectionString = connectionString;
    this.initPool();
  }

  private initPool() {
    if (!this.connectionString) {
      throw new Error("Connection string not set; cannot initialize pool");
    }

    // Don't try to end the old pool if it's already ended (would throw)
    // Just create a new one
    const oldPool = this.pool;
    if (oldPool && !(oldPool as any).ended && !(oldPool as any).ending) {
      // Old pool is still active - we shouldn't normally get here, but if we do, leave it
      // In test environments, pools might be shared, so we don't want to end them
    }

    const sslDisabled = /sslmode=disable|ssl=false/i.test(this.connectionString);

    this.pool = new Pool({
      connectionString: this.connectionString,
      // Local Postgres has no TLS; RDS needs SSL (accept self-signed / RDS certs).
      ssl: sslDisabled ? false : { rejectUnauthorized: false },
      max: 20,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      maxUses: 7500,
      allowExitOnIdle: process.env.NODE_ENV === "test",
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });

    this.db = drizzle(this.pool);
    this.sessionStore = new PostgreSqlStore({
      pool: this.pool,
      tableName: 'session',
      createTableIfMissing: true,
      pruneSessionInterval: 86400,
      errorLog: console.error
    });
  }

  private shouldCreateReminder(offsetValue?: number | null): boolean {
    return typeof offsetValue === 'number' && offsetValue > 0;
  }

  // TaskLedger User management (taskledger_users)
  async getTaskLedgerUser(id: string): Promise<TaskLedgerUser | undefined> {
    const result = await this.dbx.select().from(taskledgerUsers).where(eq(taskledgerUsers.id, id));
    return result[0];
  }

  async getTaskLedgerUserByUsername(username: string): Promise<TaskLedgerUser | undefined> {
    const result = await this.dbx.select().from(taskledgerUsers).where(eq(taskledgerUsers.username, username));
    return result[0];
  }

  async getTaskLedgerUserByEmail(email: string): Promise<TaskLedgerUser | undefined> {
    const result = await this.dbx.select().from(taskledgerUsers).where(eq(taskledgerUsers.email, email));
    return result[0];
  }

  async createTaskLedgerUser(user: InsertTaskLedgerUser): Promise<TaskLedgerUser> {
    const result = await this.dbx.insert(taskledgerUsers).values(user).returning();
    return result[0];
  }

  async updateTaskLedgerUser(id: string, updates: Partial<InsertTaskLedgerUser>): Promise<TaskLedgerUser> {
    const result = await this.dbx
      .update(taskledgerUsers)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(taskledgerUsers.id, id))
      .returning();
    return result[0];
  }

  async updateTaskLedgerUserLastLogin(id: string): Promise<void> {
    await this.dbx
      .update(taskledgerUsers)
      .set({ lastLogin: sql`now()`, updatedAt: sql`now()` })
      .where(eq(taskledgerUsers.id, id));
  }

  async deleteTaskLedgerUser(id: string): Promise<void> {
    await this.dbx.delete(taskledgerUsers).where(eq(taskledgerUsers.id, id));
  }

  async getAllTaskLedgerUsers(): Promise<TaskLedgerUser[]> {
    return await this.dbx.select().from(taskledgerUsers).orderBy(desc(taskledgerUsers.createdAt));
  }

  // HR Employees
  async getHrEmployees(firmId: string): Promise<any[]> {
    // In single-tenant mode, return all active employees without firm filtering
    // In multi-tenant mode, filter by firm_id for security
    const isSingleTenant = process.env.SINGLE_TENANT_MODE !== 'false';
    
    const baseQuery = this.dbx
      .select({
        id: hrEmployees.id,
        firmId: hrEmployees.firmId,
        employeeCode: hrEmployees.employeeCode,
        firstName: hrEmployees.firstName,
        lastName: hrEmployees.lastName,
        fullName: hrEmployees.fullName,
        email: hrEmployees.email,
        phone: hrEmployees.phone,
        currentPhotoId: hrEmployees.currentPhotoId,
        isActive: hrEmployees.isActive,
        photoBucketKey: taskLedgerDocuments.bucketKey,
        employeePhotoPath: hrEmployeePhotos.storagePath,
      })
      .from(hrEmployees)
      .leftJoin(taskLedgerDocuments, eq(hrEmployees.currentPhotoId, taskLedgerDocuments.id))
      .leftJoin(hrEmployeePhotos, eq(hrEmployees.currentPhotoId, hrEmployeePhotos.id));

    if (isSingleTenant) {
      return await baseQuery
        .where(or(eq(hrEmployees.isActive, true), isNull(hrEmployees.isActive)))
        .orderBy(asc(hrEmployees.firstName));
    }
    
    return await baseQuery
      .where(
        and(
          or(eq(hrEmployees.firmId, firmId), eq(hrEmployees.userId, firmId)),
          or(eq(hrEmployees.isActive, true), isNull(hrEmployees.isActive))
        )
      )
      .orderBy(asc(hrEmployees.firstName));
  }

  // Properties
  async getProperty(id: string): Promise<Property | undefined> {
    const result = await this.dbx.select().from(properties).where(eq(properties.id, id));
    return result[0];
  }

  async getPropertiesByUser(userId: string): Promise<Property[]> {
    return await this.dbx
      .select()
      .from(properties)
      .where(eq(properties.createdBy, userId))
      .orderBy(desc(properties.createdAt));
  }

  async createProperty(property: InsertProperty): Promise<Property> {
    const result = await this.dbx.insert(properties).values(property).returning();
    return result[0];
  }

  async updateProperty(userId: string, id: string, updates: Partial<InsertProperty>): Promise<Property> {
    const result = await this.dbx
      .update(properties)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(and(eq(properties.id, id), eq(properties.createdBy, userId)))
      .returning();
    if (!result[0]) {
      throw new Error("Property not found or you don't have permission to update it");
    }
    return result[0];
  }

  async deleteProperty(userId: string, id: string): Promise<void> {
    const result = await this.dbx
      .delete(properties)
      .where(and(eq(properties.id, id), eq(properties.createdBy, userId)))
      .returning();
    if (!result[0]) {
      throw new Error("Property not found or you don't have permission to delete it");
    }
  }

  // Tax & Legal Compliance (NEW MODULE)
  async getTaxLegalCompliance(id: string): Promise<TaxLegalCompliance | undefined> {
    const result = await this.dbx
      .select()
      .from(taxLegalCompliances)
      .where(eq(taxLegalCompliances.id, id));
    return result[0];
  }

  async listTaxLegalCompliancesByUser(userId: string): Promise<TaxLegalCompliance[]> {
    const compliances = await this.dbx
      .select()
      .from(taxLegalCompliances)
      .where(eq(taxLegalCompliances.createdBy, userId))
      .orderBy(desc(taxLegalCompliances.createdAt));

    if (!compliances.length) return compliances;

    // Avoid N+1: compute per-compliance summary in a small fixed number of queries.
    // Summary mirrors client-side buildSummary/getSummaryStatus expectations.
    try {
      const countsResult = await this.dbx.execute(sql`
        select
          i.compliance_id as compliance_id,
          count(*)::int as items_count,
          sum(
            case
              when i.status = 'pending'
                and coalesce(i.next_due_date, i.due_date) < current_date
              then 1 else 0
            end
          )::int as overdue_count
        from tax_legal_items i
        inner join tax_legal_compliances c on c.id = i.compliance_id
        where c.created_by = ${userId}
        group by i.compliance_id
      `);

      const nextResult = await this.dbx.execute(sql`
        select distinct on (i.compliance_id)
          i.compliance_id as compliance_id,
          i.id as id,
          i.title as title,
          i.notes as notes,
          i.due_date as due_date,
          i.next_due_date as next_due_date,
          i.is_recurring as is_recurring,
          i.status as status
        from tax_legal_items i
        inner join tax_legal_compliances c on c.id = i.compliance_id
        where c.created_by = ${userId}
          and i.status = 'pending'
          and coalesce(i.next_due_date, i.due_date) is not null
        order by
          i.compliance_id,
          coalesce(i.next_due_date, i.due_date) asc,
          i.created_at asc
      `);

      const countsRows: any[] =
        (countsResult as any)?.rows ?? (Array.isArray(countsResult) ? (countsResult as any) : []);
      const nextRows: any[] =
        (nextResult as any)?.rows ?? (Array.isArray(nextResult) ? (nextResult as any) : []);

      const countsByCompliance = new Map<string, { itemsCount: number; overdueCount: number }>();
      for (const r of countsRows) {
        const id = String(r.compliance_id);
        countsByCompliance.set(id, {
          itemsCount: Number(r.items_count ?? 0),
          overdueCount: Number(r.overdue_count ?? 0),
        });
      }

      const nextByCompliance = new Map<string, any>();
      for (const r of nextRows) {
        const id = String(r.compliance_id);
        nextByCompliance.set(id, {
          id: r.id,
          title: r.title ?? null,
          notes: r.notes ?? null,
          // keep both fields for effective due-date logic client-side
          dueDate: r.due_date ?? null,
          nextDueDate: r.next_due_date ?? null,
          isRecurring: r.is_recurring ?? null,
        });
      }

      return compliances.map((c: any) => {
        const counts = countsByCompliance.get(String(c.id)) ?? { itemsCount: 0, overdueCount: 0 };
        const nextDueItem = nextByCompliance.get(String(c.id)) ?? null;
        return {
          ...c,
          itemsCount: counts.itemsCount,
          overdueCount: counts.overdueCount,
          nextDueItem,
        } as any;
      });
    } catch {
      // If summary computation fails, fall back to base compliances.
      // This keeps the endpoint stable in constrained environments.
      return compliances;
    }
  }

  async createTaxLegalCompliance(input: InsertTaxLegalCompliance): Promise<TaxLegalCompliance> {
    // Strict allow-list on create (no spreading untrusted objects)
    const values: InsertTaxLegalCompliance = {
      title: input.title,
      description: input.description ?? null,
      note: (input as any).note ?? null,
      loginId: (input as any).loginId ?? null,
      category: input.category,
      subCategory: input.subCategory ?? null,
      propertyId: input.propertyId ?? null,
      customFields: input.customFields ?? {},
      createdBy: input.createdBy,
    } as any;

    const result = await this.dbx.insert(taxLegalCompliances).values(values).returning();
    return result[0];
  }

  async updateTaxLegalCompliance(
    id: string,
    updates: Partial<InsertTaxLegalCompliance>
  ): Promise<TaxLegalCompliance> {
    // Strict allow-list on update
    const u: any = updates ?? {};
    const allowed: Record<string, any> = {};
    if ("title" in u) allowed.title = u.title;
    if ("description" in u) allowed.description = u.description;
    if ("note" in u) allowed.note = u.note;
    if ("loginId" in u || "login_id" in u) allowed.loginId = u.loginId ?? u.login_id;
    if ("category" in u) allowed.category = u.category;
    if ("subCategory" in u || "sub_category" in u) allowed.subCategory = u.subCategory ?? u.sub_category;
    if ("propertyId" in u || "property_id" in u) allowed.propertyId = u.propertyId ?? u.property_id;
    if ("customFields" in u || "custom_fields" in u) allowed.customFields = u.customFields ?? u.custom_fields;

    const result = await this.dbx
      .update(taxLegalCompliances)
      .set({ ...allowed, updatedAt: sql`now()` } as any)
      .where(eq(taxLegalCompliances.id, id))
      .returning();
    return result[0];
  }

  async deleteTaxLegalCompliance(id: string): Promise<void> {
    // Ensure child schedules are cleaned up even if DB doesn't cascade.
    const items = await this.dbx
      .select({ id: taxLegalItems.id })
      .from(taxLegalItems)
      .where(eq(taxLegalItems.complianceId, id));
    for (const row of items) {
      await this.deleteTaxLegalItem(row.id);
    }
    await this.dbx.delete(taxLegalCompliances).where(eq(taxLegalCompliances.id, id));
  }

  async getTaxLegalItem(id: string): Promise<TaxLegalItem | undefined> {
    const result = await this.dbx.select().from(taxLegalItems).where(eq(taxLegalItems.id, id));
    return result[0];
  }

  async listTaxLegalItemsByCompliance(complianceId: string): Promise<TaxLegalItem[]> {
    return await this.dbx
      .select()
      .from(taxLegalItems)
      .where(eq(taxLegalItems.complianceId, complianceId))
      .orderBy(desc(taxLegalItems.dueDate));
  }

  async createTaxLegalItem(input: InsertTaxLegalItem): Promise<TaxLegalItem> {
    const isRecurring = Boolean((input as any).isRecurring);
    const recurrenceData = (input as any).recurrenceData ?? null;

    // ✅ FIX: Tax-legal create was not persisting email_recipients; edit already did.
    const sanitizedItem: InsertTaxLegalItem = {
      complianceId: (input as any).complianceId,
      title: normalizeTaskTitleValue((input as any).title),
      description: (input as any).description ?? null,
      dueDate: (input as any).dueDate,
      dueTime: (input as any).dueTime ?? null,
      amount: (input as any).amount ?? null,
      status: (input as any).status ?? "pending",
      isRecurring,
      recurrenceData,
      nextDueDate:
        isRecurring && recurrenceData
          ? computeInitialNextDueDate({
              dueDate: (input as any).dueDate,
              recurrenceData,
              now: new Date(),
            })
          : null,
      notes: (input as any).notes ?? null,
      completionNotes: (input as any).completionNotes ?? null,
      customFields: (input as any).customFields ?? {},
      emailRecipients: (input as any).emailRecipients ?? [],
      createdBy: (input as any).createdBy,
    } as any;

    const result = await this.dbx.insert(taxLegalItems).values(sanitizedItem).returning();
    return result[0];
  }

  async updateTaxLegalItem(id: string, updates: Partial<InsertTaxLegalItem>): Promise<TaxLegalItem> {
    const u: any = updates ?? {};
    const allowed: Record<string, any> = {};
    if ("title" in u) allowed.title = normalizeTaskTitleValue(u.title);
    if ("description" in u) allowed.description = u.description;
    if ("dueDate" in u || "due_date" in u) allowed.dueDate = u.dueDate ?? u.due_date;
    if ("dueTime" in u || "due_time" in u) allowed.dueTime = u.dueTime ?? u.due_time;
    if ("amount" in u) allowed.amount = u.amount;
    if ("status" in u) allowed.status = u.status;
    if ("isRecurring" in u || "is_recurring" in u) allowed.isRecurring = u.isRecurring ?? u.is_recurring;
    if ("recurrenceData" in u || "recurrence_data" in u)
      allowed.recurrenceData = u.recurrenceData ?? u.recurrence_data;
    if ("notes" in u) allowed.notes = u.notes;
    if ("completionNotes" in u || "completion_notes" in u)
      allowed.completionNotes = u.completionNotes ?? u.completion_notes;
    if ("customFields" in u || "custom_fields" in u)
      allowed.customFields = u.customFields ?? u.custom_fields;

    const shouldRecompute =
      "isRecurring" in allowed ||
      "recurrenceData" in allowed ||
      "dueDate" in allowed;

    const nextDueDate =
      shouldRecompute && (allowed.isRecurring ?? true)
        ? computeInitialNextDueDate({
            dueDate: allowed.dueDate,
            recurrenceData: allowed.recurrenceData,
            now: new Date(),
          })
        : undefined;

    const result = await this.dbx
      .update(taxLegalItems)
      .set({
        ...allowed,
        ...(nextDueDate !== undefined ? { nextDueDate } : {}),
        updatedAt: sql`now()`,
      } as any)
      .where(eq(taxLegalItems.id, id))
      .returning();
    return result[0];
  }

  async deleteTaxLegalItem(id: string): Promise<void> {
    await this.deleteOccurrenceRemindersByEntity("tax_legal_item", id);
    await this.dbx.delete(taxLegalItems).where(eq(taxLegalItems.id, id));
  }

  // Vehicles
  async getVehicle(id: string): Promise<Vehicle | undefined> {
    const result = await this.dbx.select().from(vehicles).where(eq(vehicles.id, id));
    return result[0];
  }

  async getVehiclesByUser(userId: string): Promise<Vehicle[]> {
    return await this.dbx
      .select()
      .from(vehicles)
      .where(eq(vehicles.createdBy, userId))
      .orderBy(desc(vehicles.createdAt));
  }

  async createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const result = await this.dbx.insert(vehicles).values(vehicle).returning();
    return result[0];
  }

  async updateVehicle(id: string, updates: Partial<InsertVehicle>): Promise<Vehicle> {
    const result = await this.dbx
      .update(vehicles)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(vehicles.id, id))
      .returning();
    return result[0];
  }

  async deleteVehicle(id: string): Promise<void> {
    await this.dbx.transaction(async (tx) => {
      const relatedItems = await tx
        .select({ id: vehicleItems.id })
        .from(vehicleItems)
        .where(eq(vehicleItems.vehicleId, id));

      const vehicleItemIds = relatedItems.map((item) => item.id);

      if (vehicleItemIds.length > 0) {
        await tx
          .delete(occurrenceReminders)
          .where(
            and(
              eq(occurrenceReminders.entityType, 'vehicle_item'),
              inArray(occurrenceReminders.entityId, vehicleItemIds)
            )
          );

        await tx
          .delete(vehicleItems)
          .where(inArray(vehicleItems.id, vehicleItemIds));
      }

      await tx.delete(vehicles).where(eq(vehicles.id, id));
    });
  }

  // Vehicle Items
  async getVehicleItem(id: string): Promise<VehicleItem | undefined> {
    const result = await this.dbx.select().from(vehicleItems).where(eq(vehicleItems.id, id));
    return result[0];
  }

  async getVehicleItemsByUser(userId: string): Promise<VehicleItem[]> {
    return await this.dbx
      .select()
      .from(vehicleItems)
      .where(eq(vehicleItems.createdBy, userId))
      .orderBy(desc(vehicleItems.dueDate));
  }

  async getVehicleItemsByVehicle(vehicleId: string): Promise<VehicleItem[]> {
    return await this.dbx
      .select()
      .from(vehicleItems)
      .where(eq(vehicleItems.vehicleId, vehicleId))
      .orderBy(desc(vehicleItems.dueDate));
  }

  async createVehicleItem(item: InsertVehicleItem): Promise<VehicleItem> {
    const sanitizedItem: InsertVehicleItem = {
      ...item,
      title: normalizeTaskTitleValue(item.title),
      nextDueDate: item.isRecurring || item.recurrenceData
        ? computeInitialNextDueDate({
            dueDate: item.dueDate,
            recurrenceData: item.recurrenceData,
            now: new Date(),
          })
        : null,
    };

    const result = await this.dbx.insert(vehicleItems).values(sanitizedItem).returning();
    const createdItem = result[0];
    
    // Automatically create reminder if reminderDays is set
    const offsetConfig = normalizeReminderOffset(
      createdItem.reminderOffsetValue,
      createdItem.reminderOffsetUnit,
      createdItem.reminderDays
    );

    if (this.shouldCreateReminder(offsetConfig.value)) {
      const parseJsonbArray = (field: any): string[] => {
        if (Array.isArray(field)) return field.filter((x) => typeof x === "string" && x.trim());
        if (typeof field === "string") {
          try {
            const parsed = JSON.parse(field);
            return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x.trim()) : [];
          } catch {
            return [];
          }
        }
        return [];
      };

      const notificationChannels = parseJsonbArray(createdItem.notificationChannels);
      const emailRecipients = parseJsonbArray(createdItem.emailRecipients);
      const whatsappRecipients = parseJsonbArray(createdItem.whatsappRecipients);
      const smsRecipients = parseJsonbArray((createdItem as any).smsRecipients);
      const reminderTimes = parseJsonbArray(createdItem.reminderTimes);

      const dueDateYmd =
        typeof createdItem.dueDate === "string"
          ? createdItem.dueDate
          : new Date(createdItem.dueDate).toISOString().split("T")[0];

      const nextDueDateYmd =
        createdItem.nextDueDate
          ? (typeof createdItem.nextDueDate === "string"
              ? createdItem.nextDueDate
              : new Date(createdItem.nextDueDate).toISOString().split("T")[0])
          : null;

      await this.materializeOccurrenceRemindersForEntity({
        userId: createdItem.createdBy,
        entityType: "vehicle_item",
        entityId: createdItem.id,
        taskTitle: createdItem.title,
        isRecurring: !!createdItem.isRecurring,
        dueDateYmd,
        nextDueDateYmd,
        recurrenceData: createdItem.recurrenceData,
        reminderOffsetValue: offsetConfig.value,
        reminderOffsetUnit: offsetConfig.unit,
        notificationChannels: notificationChannels.length > 0 ? notificationChannels : ["email"],
        emailRecipients,
        whatsappRecipients,
        smsRecipients,
        reminderTimes: reminderTimes.length > 0 ? reminderTimes : ["09:00"],
      });
    }
    
    return createdItem;
  }

  async updateVehicleItem(id: string, updates: Partial<InsertVehicleItem>): Promise<VehicleItem> {
    const normalizedUpdates: Partial<InsertVehicleItem> = { ...updates };
    if (normalizedUpdates.title !== undefined && normalizedUpdates.title !== null) {
      normalizedUpdates.title = normalizeTaskTitleValue(normalizedUpdates.title);
    }

    const shouldRecompute =
      normalizedUpdates.isRecurring !== undefined ||
      normalizedUpdates.recurrenceData !== undefined ||
      normalizedUpdates.dueDate !== undefined;

    const nextDueDate =
      shouldRecompute && (normalizedUpdates.isRecurring ?? true)
        ? computeInitialNextDueDate({
            dueDate: normalizedUpdates.dueDate,
            recurrenceData: normalizedUpdates.recurrenceData,
            now: new Date(),
          })
        : undefined;

    const result = await this.dbx
      .update(vehicleItems)
      .set({
        ...normalizedUpdates,
        ...(nextDueDate !== undefined ? { nextDueDate } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(vehicleItems.id, id))
      .returning();
    return result[0];
  }

  async deleteVehicleItem(id: string): Promise<void> {
    // Delete associated reminders first
    await this.deleteOccurrenceRemindersByEntity('vehicle_item', id);
    // Then delete the vehicle item
    await this.dbx.delete(vehicleItems).where(eq(vehicleItems.id, id));
  }

  async getUpcomingVehicleItems(userId: string, days: number): Promise<VehicleItem[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);
    
    return await this.dbx
      .select()
      .from(vehicleItems)
      .where(
        and(
          eq(vehicleItems.createdBy, userId),
          gte(vehicleItems.dueDate, new Date().toISOString().split('T')[0]),
          lte(vehicleItems.dueDate, futureDate.toISOString().split('T')[0]),
          eq(vehicleItems.status, 'pending')
        )
      )
      .orderBy(vehicleItems.dueDate);
  }

  async getOverdueVehicleItems(userId: string): Promise<VehicleItem[]> {
    return await this.dbx
      .select()
      .from(vehicleItems)
      .where(
        and(
          eq(vehicleItems.createdBy, userId),
          sql`${vehicleItems.dueDate} < CURRENT_DATE`,
          eq(vehicleItems.status, 'pending')
        )
      )
      .orderBy(vehicleItems.dueDate);
  }

  // Assets
  async getAsset(id: string): Promise<Asset | undefined> {
    const result = await this.dbx.select().from(assets).where(eq(assets.id, id));
    return result[0];
  }

  async getAssetsByUser(userId: string): Promise<Asset[]> {
    return await this.dbx
      .select()
      .from(assets)
      .where(eq(assets.createdBy, userId))
      .orderBy(desc(assets.createdAt));
  }

  async createAsset(asset: InsertAsset): Promise<Asset> {
    const result = await this.dbx.insert(assets).values(asset).returning();
    return result[0];
  }

  async updateAsset(id: string, updates: Partial<InsertAsset>): Promise<Asset> {
    const result = await this.dbx
      .update(assets)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(assets.id, id))
      .returning();
    return result[0];
  }

  async deleteAsset(id: string): Promise<void> {
    await this.dbx.delete(assets).where(eq(assets.id, id));
  }

  // Asset Items
  async getAssetItem(id: string): Promise<AssetItem | undefined> {
    const result = await this.dbx.select().from(assetItems).where(eq(assetItems.id, id));
    return result[0];
  }

  async getAssetItemsByUser(userId: string): Promise<AssetItem[]> {
    return await this.dbx
      .select()
      .from(assetItems)
      .where(eq(assetItems.createdBy, userId))
      .orderBy(desc(assetItems.dueDate));
  }

  async getAssetItemsByAsset(assetId: string): Promise<AssetItem[]> {
    return await this.dbx
      .select()
      .from(assetItems)
      .where(eq(assetItems.assetId, assetId))
      .orderBy(desc(assetItems.dueDate));
  }

  async createAssetItem(item: InsertAssetItem): Promise<AssetItem> {
    const sanitizedItem: InsertAssetItem = {
      ...item,
      title: normalizeTaskTitleValue(item.title),
      nextDueDate: item.isRecurring || item.recurrenceData
        ? computeInitialNextDueDate({
            dueDate: item.dueDate,
            recurrenceData: item.recurrenceData,
            now: new Date(),
          })
        : null,
    };

    const result = await this.dbx.insert(assetItems).values(sanitizedItem).returning();
    const createdItem = result[0];

    const offsetConfig = normalizeReminderOffset(
      createdItem.reminderOffsetValue,
      createdItem.reminderOffsetUnit,
      createdItem.reminderDays
    );

    if (this.shouldCreateReminder(offsetConfig.value)) {
      const parseJsonbArray = (field: any): string[] => {
        if (Array.isArray(field)) return field.filter((x) => typeof x === "string" && x.trim());
        if (typeof field === "string") {
          try {
            const parsed = JSON.parse(field);
            return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x.trim()) : [];
          } catch {
            return [];
          }
        }
        return [];
      };

      const notificationChannels = parseJsonbArray(createdItem.notificationChannels);
      const emailRecipients = parseJsonbArray(createdItem.emailRecipients);
      const whatsappRecipients = parseJsonbArray(createdItem.whatsappRecipients);
      const smsRecipients = parseJsonbArray((createdItem as any).smsRecipients);
      const reminderTimes = parseJsonbArray(createdItem.reminderTimes);

      const dueDateYmd =
        typeof createdItem.dueDate === "string"
          ? createdItem.dueDate
          : new Date(createdItem.dueDate).toISOString().split("T")[0];

      const nextDueDateYmd =
        createdItem.nextDueDate
          ? (typeof createdItem.nextDueDate === "string"
              ? createdItem.nextDueDate
              : new Date(createdItem.nextDueDate).toISOString().split("T")[0])
          : null;

      await this.materializeOccurrenceRemindersForEntity({
        userId: createdItem.createdBy,
        entityType: "asset_item",
        entityId: createdItem.id,
        taskTitle: createdItem.title,
        isRecurring: !!createdItem.isRecurring,
        dueDateYmd,
        nextDueDateYmd,
        recurrenceData: createdItem.recurrenceData,
        reminderOffsetValue: offsetConfig.value,
        reminderOffsetUnit: offsetConfig.unit,
        notificationChannels: notificationChannels.length > 0 ? notificationChannels : ["email"],
        emailRecipients,
        whatsappRecipients,
        smsRecipients,
        reminderTimes: reminderTimes.length > 0 ? reminderTimes : ["09:00"],
      });
    }

    return createdItem;
  }

  async updateAssetItem(id: string, updates: Partial<InsertAssetItem>): Promise<AssetItem> {
    const result = await this.dbx
      .update(assetItems)
      .set({
        ...updates,
        ...(updates.isRecurring !== undefined ||
        updates.recurrenceData !== undefined ||
        updates.dueDate !== undefined
          ? {
              nextDueDate:
                (updates.isRecurring ?? true)
                  ? computeInitialNextDueDate({
                      dueDate: updates.dueDate,
                      recurrenceData: updates.recurrenceData,
                      now: new Date(),
                    })
                  : null,
            }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(assetItems.id, id))
      .returning();
    return result[0];
  }

  async deleteAssetItem(id: string): Promise<void> {
    // Delete associated reminders first
    await this.deleteOccurrenceRemindersByEntity('asset_item', id);
    // Then delete the asset item
    await this.dbx.delete(assetItems).where(eq(assetItems.id, id));
  }

  // Task Action Items
  async getTaskActionItem(id: string): Promise<TaskActionItem | undefined> {
    const result = await this.dbx.select().from(taskActionItems).where(eq(taskActionItems.id, id));
    return result[0];
  }

  async getTaskActionItemsByUser(userId: string): Promise<TaskActionItem[]> {
    return await this.dbx
      .select()
      .from(taskActionItems)
      .where(eq(taskActionItems.createdBy, userId))
      .orderBy(desc(taskActionItems.dueDate));
  }

  async getTaskActionItemsByTaskAction(taskActionId: string): Promise<TaskActionItem[]> {
    return await this.dbx
      .select()
      .from(taskActionItems)
      .where(eq(taskActionItems.taskActionId, taskActionId))
      .orderBy(desc(taskActionItems.dueDate));
  }

  async createTaskActionItem(item: InsertTaskActionItem): Promise<TaskActionItem> {
    const sanitizedItem: InsertTaskActionItem = {
      ...item,
      title: normalizeTaskTitleValue(item.title),
      nextDueDate: item.isRecurring || item.recurrenceData
        ? computeInitialNextDueDate({
            dueDate: item.dueDate,
            recurrenceData: item.recurrenceData,
            now: new Date(),
          })
        : null,
    };

    const result = await this.dbx.insert(taskActionItems).values(sanitizedItem).returning();
    const createdItem = result[0];

    const offsetConfig = normalizeReminderOffset(
      createdItem.reminderOffsetValue,
      createdItem.reminderOffsetUnit,
      createdItem.reminderDays
    );

    const parseJsonbArray = (field: any): string[] => {
      if (Array.isArray(field)) return field.filter((entry) => typeof entry === "string");
      if (typeof field === "string") {
        try {
          const parsed = JSON.parse(field);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    if (this.shouldCreateReminder(offsetConfig.value)) {
      const notificationChannels = parseJsonbArray(createdItem.notificationChannels);
      const emailRecipients = parseJsonbArray(createdItem.emailRecipients);
      const whatsappRecipients = parseJsonbArray(createdItem.whatsappRecipients);
      const reminderTimes = parseJsonbArray(createdItem.reminderTimes);

      const dueDateStr = new Date(createdItem.dueDate as any)
        .toISOString()
        .split("T")[0];

      // ✅ NEW: Use occurrence_reminders system (replaces reminder_schedules)
      await this.deleteOccurrenceRemindersByEntity("task_action_item", createdItem.id);
      await this.materializeOccurrenceRemindersForEntity({
        userId: createdItem.createdBy,
        entityType: "task_action_item",
        entityId: createdItem.id,
        taskTitle: createdItem.title,
        isRecurring: !!createdItem.isRecurring,
        dueDateYmd: dueDateStr,
        nextDueDateYmd: createdItem.nextDueDate ? (typeof createdItem.nextDueDate === 'string' ? createdItem.nextDueDate : new Date(createdItem.nextDueDate).toISOString().split('T')[0]) : null,
        recurrenceData: createdItem.recurrenceData,
        reminderOffsetValue: offsetConfig.value,
        reminderOffsetUnit: offsetConfig.unit,
        notificationChannels: notificationChannels.length > 0 ? notificationChannels : ["email"],
        emailRecipients,
        whatsappRecipients,
        smsRecipients: [],
        reminderTimes: reminderTimes.length > 0 ? reminderTimes : ["09:00"]
      });
    }

    return createdItem;
  }

  async updateTaskActionItem(id: string, updates: Partial<InsertTaskActionItem>): Promise<TaskActionItem> {
    const result = await this.dbx
      .update(taskActionItems)
      .set({
        ...updates,
        ...(updates.isRecurring !== undefined ||
        updates.recurrenceData !== undefined ||
        updates.dueDate !== undefined
          ? {
              nextDueDate:
                (updates.isRecurring ?? true)
                  ? computeInitialNextDueDate({
                      dueDate: updates.dueDate,
                      recurrenceData: updates.recurrenceData,
                      now: new Date(),
                    })
                  : null,
            }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(taskActionItems.id, id))
      .returning();
    return result[0];
  }

  async deleteTaskActionItem(id: string): Promise<void> {
    // Delete associated reminders first
    await this.deleteOccurrenceRemindersByEntity("task_action_item", id);
    // Then delete the task action item
    await this.dbx.delete(taskActionItems).where(eq(taskActionItems.id, id));
  }

  // Task Ledger Documents (new normalized structure)

  // Task Ledger Documents (new normalized structure)
  async upsertTaskLedgerDocumentAndLinkFromUpload(params: {
    orgId: string,
    userId: string,
    entityType: string,
    entityId: string,
    documentType?: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    fileBuffer: Buffer
  }): Promise<{ document: TaskLedgerDocument, link: TaskLedgerDocumentLink }> {
    const { orgId, userId, entityType, entityId, documentType, fileName, mimeType, sizeBytes, fileBuffer } = params;

    // 1) Compute sha256 server-side
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 2) Run in transaction for consistency
    return await this.dbx.transaction(async (tx) => {
      // Search for existing doc first (to avoid unnecessary storage upload)
      const existingDocs = await tx
        .select()
        .from(taskLedgerDocuments)
        .where(and(eq(taskLedgerDocuments.orgId, orgId), eq(taskLedgerDocuments.sha256, sha256)));

      let document: TaskLedgerDocument;

      if (existingDocs.length > 0) {
        document = existingDocs[0];
        const finalBucket = getTaskLedgerBucket();
        const objectStorageService = new ObjectStorageService();

        // Self-healing: Always ensure the file exists in storage when deduping.
        // This recovers from cases where the file was deleted but the DB row remained (e.g. pendingDelete).
        const finalKey = document.bucketKey;
        console.log(`[DEDUP_DEBUG] Reusing existing document ${document.id}. Finalizing to: "${finalBucket}/${finalKey}"`);
        await objectStorageService.uploadObject(finalBucket, finalKey, fileBuffer, mimeType);
        
        // VERIFY: Check if object exists immediately after upload
        const exists = await objectStorageService.verifyObjectExists(finalBucket, finalKey);
        if (!exists) {
          console.error(`[DEDUP_ERROR] Self-healing failed for "${finalBucket}/${finalKey}"`);
        } else {
          console.log(`[DEDUP_DEBUG] Self-healing verified for "${finalBucket}/${finalKey}"`);
        }

        // Recovery: if pendingDelete is true, set it to false
        if (document.pendingDelete) {
          const [updated] = await tx
            .update(taskLedgerDocuments)
            .set({ pendingDelete: false })
            .where(eq(taskLedgerDocuments.id, document.id))
            .returning();
          document = updated;
          console.log(`[DEDUP_DEBUG] Recovered pendingDelete document ${document.id}`);
        }
      } else {
        // Not found: upload to storage and insert doc row.
        // Use plain INSERT; on unique violation (concurrent duplicate) select existing row.
        // Enforce Task Ledger path: task_ledger/uploaded_documents/<orgId>/<documentId>/<safeFileName>
        const documentId = crypto.randomUUID();
        const finalKey = buildTaskLedgerObjectKey({ orgId, documentId, originalFileName: fileName });
        const finalBucket = getTaskLedgerBucket();

        const objectStorageService = new ObjectStorageService();
        console.log(`[UPLOAD_DEBUG] New document upload. Bucket: "${finalBucket}", Key: "${finalKey}"`);
        await objectStorageService.uploadObject(finalBucket, finalKey, fileBuffer, mimeType);
        
        // VERIFY: Check if object exists immediately after upload
        const exists = await objectStorageService.verifyObjectExists(finalBucket, finalKey);
        if (!exists) {
          console.error(`[UPLOAD_ERROR] New upload failed verification for "${finalBucket}/${finalKey}"`);
          throw new Error(`Failed to verify upload at ${finalKey}`);
        }
        console.log(`[UPLOAD_DEBUG] New upload verified for "${finalBucket}/${finalKey}"`);

        const safeFileName = finalKey.slice(finalKey.lastIndexOf("/") + 1);
        try {
          const [newDoc] = await tx
            .insert(taskLedgerDocuments)
            .values({
              id: documentId,
              orgId,
              bucketKey: finalKey,
              sha256,
              originalName: fileName,
              fileName: safeFileName,
              mimeType,
              sizeBytes,
              createdBy: userId,
              pendingDelete: false,
            })
            .returning();
          document = newDoc;
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === '23505') {
            // Unique violation: concurrent insert of same (org_id, sha256); use existing row
            const [existing] = await tx
              .select()
              .from(taskLedgerDocuments)
              .where(and(eq(taskLedgerDocuments.orgId, orgId), eq(taskLedgerDocuments.sha256, sha256)));
            if (existing) {
              document = existing;
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }

      // 3) Create link idempotently
      const [link] = await tx
        .insert(taskLedgerDocumentLinks)
        .values({
          orgId,
          documentId: document.id,
          entityType,
          entityId,
          documentType: documentType || null,
        })
        .onConflictDoNothing({
          target: [
            taskLedgerDocumentLinks.orgId,
            taskLedgerDocumentLinks.documentId,
            taskLedgerDocumentLinks.entityType,
            taskLedgerDocumentLinks.entityId
          ]
        })
        .returning();

      // If link was already existing, fetch it
      if (!link) {
        const [existingLink] = await tx
          .select()
          .from(taskLedgerDocumentLinks)
          .where(and(
            eq(taskLedgerDocumentLinks.orgId, orgId),
            eq(taskLedgerDocumentLinks.documentId, document.id),
            eq(taskLedgerDocumentLinks.entityType, entityType),
            eq(taskLedgerDocumentLinks.entityId, entityId)
          ));
        return { document, link: existingLink };
      }

      return { document, link };
    });
  }

  async createTaskLedgerDocument(document: InsertTaskLedgerDocument): Promise<TaskLedgerDocument> {
    const result = await this.dbx.insert(taskLedgerDocuments).values(document).returning();
    return result[0];
  }

  async getTaskLedgerDocument(id: string, orgId: string): Promise<TaskLedgerDocument | undefined> {
    const result = await this.dbx
      .select()
      .from(taskLedgerDocuments)
      .where(and(eq(taskLedgerDocuments.id, id), eq(taskLedgerDocuments.orgId, orgId)));
    return result[0];
  }

  async updateTaskLedgerDocument(id: string, orgId: string, updates: Partial<TaskLedgerDocument>): Promise<TaskLedgerDocument> {
    const result = await this.dbx
      .update(taskLedgerDocuments)
      .set(updates)
      .where(and(eq(taskLedgerDocuments.id, id), eq(taskLedgerDocuments.orgId, orgId)))
      .returning();
    return result[0];
  }

  async deleteTaskLedgerDocument(id: string, orgId: string): Promise<void> {
    // Links will cascade delete due to FK constraint
    await this.dbx
      .delete(taskLedgerDocuments)
      .where(and(eq(taskLedgerDocuments.id, id), eq(taskLedgerDocuments.orgId, orgId)));
  }

  async createTaskLedgerDocumentLink(link: InsertTaskLedgerDocumentLink): Promise<TaskLedgerDocumentLink> {
    return await this.dbx.transaction(async (tx) => {
      // 1) Lock the parent document row FIRST (same lock as unlink)
      // This prevents a race condition where a document might be marked for deletion
      // while a new link is being created.
      const lockResult = await tx.execute(sql`
        SELECT ${taskLedgerDocuments.id}
        FROM ${taskLedgerDocuments}
        WHERE ${taskLedgerDocuments.id} = ${link.documentId} AND ${taskLedgerDocuments.orgId} = ${link.orgId}
        FOR UPDATE
      `);

      const docRows = (lockResult as any)?.rows || lockResult;
      const doc = (docRows as any)?.[0];

      if (!doc) {
        throw new Error("Parent document not found or access denied");
      }

      // 2) If doc is marked as pendingDelete, unmark it because we are adding a new link
      await tx
        .update(taskLedgerDocuments)
        .set({ pendingDelete: false })
        .where(and(eq(taskLedgerDocuments.id, link.documentId), eq(taskLedgerDocuments.orgId, link.orgId)));

      // 3) Insert link
      const result = await tx.insert(taskLedgerDocumentLinks).values(link).returning();
      return result[0];
    });
  }

  async getTaskLedgerDocumentsByEntity(
    orgId: string, 
    entityType: string, 
    entityId: string
  ): Promise<Array<TaskLedgerDocument & { documentType: string | null; linkId: string }>> {
    const result = await this.dbx
      .select({
        id: taskLedgerDocuments.id,
        orgId: taskLedgerDocuments.orgId,
        bucketKey: taskLedgerDocuments.bucketKey,
        originalName: taskLedgerDocuments.originalName,
        fileName: taskLedgerDocuments.fileName,
        mimeType: taskLedgerDocuments.mimeType,
        sizeBytes: taskLedgerDocuments.sizeBytes,
        sha256: taskLedgerDocuments.sha256,
        pendingDelete: taskLedgerDocuments.pendingDelete,
        createdBy: taskLedgerDocuments.createdBy,
        createdAt: taskLedgerDocuments.createdAt,
        documentType: taskLedgerDocumentLinks.documentType,
        linkId: taskLedgerDocumentLinks.id,
      })
      .from(taskLedgerDocumentLinks)
      .innerJoin(taskLedgerDocuments, eq(taskLedgerDocumentLinks.documentId, taskLedgerDocuments.id))
      .where(
        and(
          eq(taskLedgerDocumentLinks.orgId, orgId),
          eq(taskLedgerDocumentLinks.entityType, entityType),
          eq(taskLedgerDocumentLinks.entityId, entityId),
          eq(taskLedgerDocuments.pendingDelete, false)
        )
      )
      .orderBy(desc(taskLedgerDocuments.createdAt));
    return result;
  }

  async getTaskLedgerDocumentLink(linkId: string, orgId: string): Promise<TaskLedgerDocumentLink | undefined> {
    const result = await this.dbx
      .select()
      .from(taskLedgerDocumentLinks)
      .where(and(eq(taskLedgerDocumentLinks.id, linkId), eq(taskLedgerDocumentLinks.orgId, orgId)));
    return result[0];
  }

  async deleteTaskLedgerDocumentLink(linkId: string, orgId: string): Promise<void> {
    await this.dbx
      .delete(taskLedgerDocumentLinks)
      .where(and(eq(taskLedgerDocumentLinks.id, linkId), eq(taskLedgerDocumentLinks.orgId, orgId)));
  }

  async countTaskLedgerDocumentLinksByDocumentId(documentId: string, orgId: string): Promise<number> {
    const result = await this.dbx
      .select({ count: sql<number>`count(*)::int` })
      .from(taskLedgerDocumentLinks)
      .where(and(eq(taskLedgerDocumentLinks.documentId, documentId), eq(taskLedgerDocumentLinks.orgId, orgId)));
    return result[0]?.count ?? 0;
  }

  /**
   * Atomic unlinking of a document from an entity.
   * If it's the last link, marks the document as pending_delete.
   * Uses transactions and row-level locking to prevent race conditions.
   */
  async unlinkTaskLedgerDocumentAtomic(linkId: string, orgId: string): Promise<{ remainingLinks: number; documentId?: string; bucketKey?: string }> {
    return await this.dbx.transaction(async (tx) => {
      // 1) Find the link
      const [link] = await tx
        .select()
        .from(taskLedgerDocumentLinks)
        .where(
          and(
            eq(taskLedgerDocumentLinks.id, linkId),
            eq(taskLedgerDocumentLinks.orgId, orgId)
          )
        );
      
      if (!link) {
        return { remainingLinks: -1 }; // Link not found
      }

      const docId = link.documentId;

      // 2) Lock parent doc row FIRST to prevent race conditions
      // We alias columns explicitly to avoid driver-specific casing issues (snake_case vs camelCase)
      const lockResult = await tx.execute(sql`
        SELECT ${taskLedgerDocuments.id} as "id", ${taskLedgerDocuments.bucketKey} as "bucketKey" 
        FROM ${taskLedgerDocuments} 
        WHERE ${taskLedgerDocuments.id} = ${docId} AND ${taskLedgerDocuments.orgId} = ${orgId} 
        FOR UPDATE
      `);
      
      const docRows = (lockResult as any)?.rows || lockResult;
      const doc = (docRows as any)?.[0];

      if (!doc) {
        // Dangling link: parent doc record missing from DB. Delete link and signal -2.
        await tx
          .delete(taskLedgerDocumentLinks)
          .where(and(eq(taskLedgerDocumentLinks.id, linkId), eq(taskLedgerDocumentLinks.orgId, orgId)));
        return { remainingLinks: -2, documentId: docId };
      }

      // 3) Delete the link
      await tx
        .delete(taskLedgerDocumentLinks)
        .where(and(eq(taskLedgerDocumentLinks.id, linkId), eq(taskLedgerDocumentLinks.orgId, orgId)));

      // 4) Count remaining links within the same transaction/lock
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(taskLedgerDocumentLinks)
        .where(
          and(
            eq(taskLedgerDocumentLinks.documentId, docId),
            eq(taskLedgerDocumentLinks.orgId, orgId)
          )
        );
      
      const remaining = countResult?.count ?? 0;

      if (remaining === 0) {
        // 5) Mark as pendingDelete (soft-state for cleanup safety)
        await tx
          .update(taskLedgerDocuments)
          .set({ pendingDelete: true })
          .where(and(eq(taskLedgerDocuments.id, docId), eq(taskLedgerDocuments.orgId, orgId)));

        return { remainingLinks: 0, documentId: docId, bucketKey: doc.bucketKey };
      }

      return { remainingLinks: remaining };
    });
  }

  async getAllTaskLedgerDocumentBucketKeys(): Promise<string[]> {
    const result = await this.dbx
      .select({ bucketKey: taskLedgerDocuments.bucketKey })
      .from(taskLedgerDocuments);
    return result.map(r => r.bucketKey);
  }

  // Dashboard stats
  async getDashboardStats(userId: string): Promise<{
    overdue: number;
    thisWeek: number;
    properties: number;
    assets: number;
    vehicles: number;
  }> {
    // ✅ Uses occurrence_reminders as single source of truth (matches Task Management)
    // Counts unique occurrence_key entries (deduplicated by occurrence)
    const todayYmd = getTodayYmdIST();
    
    // Calculate end of week (7 days from today) in IST
    const endOfWeekYmd = (() => {
      const today = new Date(todayYmd);
      today.setDate(today.getDate() + 7);
      return today.toISOString().split('T')[0];
    })();

    const result = await this.dbx.execute(sql`
      WITH occurrence_groups AS (
        SELECT
          occurrence_key,
          due_date_local_ymd,
          SUM(CASE WHEN task_status = 'pending' THEN 1 ELSE 0 END)::int as pending_rows
        FROM occurrence_reminders
        WHERE user_id = ${userId}
        GROUP BY occurrence_key, due_date_local_ymd
      ),
      task_counts AS (
        SELECT
          -- Count overdue items (pending and past today)
          SUM(CASE WHEN pending_rows > 0 AND due_date_local_ymd < ${todayYmd} THEN 1 ELSE 0 END)::int as overdue_count,
          
          -- Count items due this week (pending and due between today and end of week)
          SUM(CASE WHEN pending_rows > 0 AND due_date_local_ymd >= ${todayYmd} AND due_date_local_ymd <= ${endOfWeekYmd} THEN 1 ELSE 0 END)::int as thisweek_count
        FROM occurrence_groups
      ),
      entity_counts AS (
        SELECT
          (SELECT COUNT(*) FROM properties WHERE created_by = ${userId}) as properties_count,
          (SELECT COUNT(*) FROM assets WHERE created_by = ${userId}) as assets_count,
          (SELECT COUNT(*) FROM vehicles WHERE created_by = ${userId}) as vehicles_count
      )
      SELECT 
        COALESCE(t.overdue_count, 0)::int as overdue,
        COALESCE(t.thisweek_count, 0)::int as thisweek,
        COALESCE(e.properties_count, 0)::int as properties,
        COALESCE(e.assets_count, 0)::int as assets,
        COALESCE(e.vehicles_count, 0)::int as vehicles
      FROM task_counts t
      CROSS JOIN entity_counts e
    `);

    const stats = result.rows[0] as any;
    return {
      overdue: Number(stats.overdue),
      thisWeek: Number(stats.thisweek),
      properties: Number(stats.properties),
      assets: Number(stats.assets),
      vehicles: Number(stats.vehicles),
    };
  }

  // Dashboard due items (from occurrence_reminders as source of truth)
  async getUpcomingDueItems(userId: string, days: number): Promise<Array<{
    id: string;
    title: string;
    category: string;
    dueDate: string;
    status: string;
    entityType: "tax" | "vehicle" | "asset" | "action";
    entityId: string;
    occurrenceKey: string;
  }>> {
    const todayYmd = getTodayYmdIST();
    const toYmd = (() => {
      const today = new Date(todayYmd);
      today.setDate(today.getDate() + days);
      return today.toISOString().split('T')[0];
    })();

    const result = await this.dbx.execute(sql`
      SELECT DISTINCT ON (occurrence_key)
        occurrence_key,
        entity_id,
        task_title,
        due_date_local_ymd,
        task_status,
        entity_type
      FROM occurrence_reminders
      WHERE user_id = ${userId}
        AND task_status <> 'completed'
        AND due_date_local_ymd >= ${todayYmd}
        AND due_date_local_ymd <= ${toYmd}
      ORDER BY occurrence_key, reminder_at_utc ASC, created_at ASC
    `);

    const rows = ((result as any)?.rows ?? []) as Array<{
      occurrence_key: string;
      entity_id: string;
      task_title: string;
      due_date_local_ymd: string;
      task_status: string;
      entity_type: string;
    }>;

    return rows.map((row) => {
      const entityType = (() => {
        switch (row.entity_type) {
          case 'vehicle_item': return 'vehicle';
          case 'asset_item': return 'asset';
          case 'task_action_item': return 'action';
          case 'task_action': return 'action';
          case 'tax_legal_item':
          case 'tax_item': return 'tax';
          default: return 'tax';
        }
      })();

      return {
        id: row.occurrence_key,
        title: row.task_title,
        category: 'Other',
        dueDate: row.due_date_local_ymd,
        status: row.task_status,
        entityType: entityType as "tax" | "vehicle" | "asset" | "action",
        entityId: row.entity_id,
        occurrenceKey: row.occurrence_key,
      };
    });
  }

  async getOverdueDueItems(userId: string): Promise<Array<{
    id: string;
    title: string;
    category: string;
    dueDate: string;
    status: string;
    entityType: "tax" | "vehicle" | "asset" | "action";
    entityId: string;
    occurrenceKey: string;
  }>> {
    const todayYmd = getTodayYmdIST();

    const result = await this.dbx.execute(sql`
      SELECT DISTINCT ON (occurrence_key)
        occurrence_key,
        entity_id,
        task_title,
        due_date_local_ymd,
        task_status,
        entity_type
      FROM occurrence_reminders
      WHERE user_id = ${userId}
        AND task_status <> 'completed'
        AND due_date_local_ymd < ${todayYmd}
      ORDER BY occurrence_key, reminder_at_utc ASC, created_at ASC
    `);

    const rows = ((result as any)?.rows ?? []) as Array<{
      occurrence_key: string;
      entity_id: string;
      task_title: string;
      due_date_local_ymd: string;
      task_status: string;
      entity_type: string;
    }>;

    return rows.map((row) => {
      const entityType = (() => {
        switch (row.entity_type) {
          case 'vehicle_item': return 'vehicle';
          case 'asset_item': return 'asset';
          case 'task_action_item': return 'action';
          case 'task_action': return 'action';
          case 'tax_legal_item':
          case 'tax_item': return 'tax';
          default: return 'tax';
        }
      })();

      return {
        id: row.occurrence_key,
        title: row.task_title,
        category: 'Other',
        dueDate: row.due_date_local_ymd,
        status: row.task_status,
        entityType: entityType as "tax" | "vehicle" | "asset" | "action",
        entityId: row.entity_id,
        occurrenceKey: row.occurrence_key,
      };
    });
  }

  // Calendar data
  // ⭐ Calendar API response includes dueDateLocalYmd for reliable day-grouping (no timezone bugs)
  /**
   * ⭐ NEW: Get calendar occurrences directly from DB (occurrence_reminders table)
   * This replaces the frontend recurrence expander with DB-driven data.
   * Returns one row per occurrence_key (grouped), not per reminder recipient.
   */
  async getOccurrenceInstancesForCalendar(
    userId: string,
    startDateStr: string,
    endDateStr: string
  ): Promise<Array<{
    occurrenceKey: string;
    entityType: string;
    entityId: string;
    taskTitle: string;
    dueDateLocalYmd: string;
    occurrenceTaskUtc: Date;
    taskStatus: string;
    completedAt: Date | null;
    taskNote: string | null;
    remindersPending: number;
    remindersSent: number;
    remindersFailed: number;
    isRecurringOccurrence: boolean;
    seriesMasterId: string | null;
  }>> {
    if (!this.db) {
      console.warn("getOccurrenceInstancesForCalendar: DB not initialized (SKIP_STORAGE_INIT)");
      return [];
    }

    // Query occurrence_reminders table directly
    // Group by occurrence_key to get one row per occurrence (not per reminder)
    const rows = await this.dbx
      .select({
        occurrenceKey: occurrenceReminders.occurrenceKey,
        entityType: occurrenceReminders.entityType,
        entityId: occurrenceReminders.entityId,
        taskTitle: occurrenceReminders.taskTitle,
        dueDateLocalYmd: occurrenceReminders.dueDateLocalYmd,
        occurrenceTaskUtc: occurrenceReminders.occurrenceTaskUtc,
        taskStatus: occurrenceReminders.taskStatus,
        completedAt: occurrenceReminders.completedAt,
        taskNote: occurrenceReminders.taskNote,
        // Aggregate from recipient_status JSONB across all channels
        remindersPending: sql<number>`
          SUM((
            SELECT COUNT(*)
            FROM jsonb_each(${occurrenceReminders.recipientStatus})
            WHERE value->>'status' = 'pending'
          ))
        `,
        remindersSent: sql<number>`
          SUM((
            SELECT COUNT(*)
            FROM jsonb_each(${occurrenceReminders.recipientStatus})
            WHERE value->>'status' = 'sent'
          ))
        `,
        remindersFailed: sql<number>`
          SUM((
            SELECT COUNT(*)
            FROM jsonb_each(${occurrenceReminders.recipientStatus})
            WHERE value->>'status' = 'failed'
          ))
        `,
      })
      .from(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.userId, userId),
          gte(occurrenceReminders.dueDateLocalYmd, startDateStr),
          lte(occurrenceReminders.dueDateLocalYmd, endDateStr)
        )
      )
      .groupBy(
        occurrenceReminders.occurrenceKey,
        occurrenceReminders.entityType,
        occurrenceReminders.entityId,
        occurrenceReminders.taskTitle,
        occurrenceReminders.dueDateLocalYmd,
        occurrenceReminders.occurrenceTaskUtc,
        occurrenceReminders.taskStatus,
        occurrenceReminders.completedAt,
        occurrenceReminders.taskNote
      )
      .orderBy(
        asc(occurrenceReminders.dueDateLocalYmd),
        asc(occurrenceReminders.occurrenceTaskUtc)
      );

    // Determine if each occurrence is recurring by checking if occurrence_key contains "::"
    // NOTE: All occurrences now use format entityId::ISO_DATE (always has ::)
    // To properly detect recurring vs one-time, we'd need to check parent entity's recurrence_data
    // For now, assume all occurrences with :: are potentially recurring
    return rows.map((row) => {
      const isRecurring = row.occurrenceKey.includes("::");
      const seriesMasterId = isRecurring ? row.entityId : null;
      
      return {
        ...row,
        isRecurringOccurrence: isRecurring,
        seriesMasterId,
        remindersPending: Number(row.remindersPending) || 0,
        remindersSent: Number(row.remindersSent) || 0,
        remindersFailed: Number(row.remindersFailed) || 0,
      };
    });
  }

  async getCalendarItems(userId: string, startDate: Date, endDate: Date): Promise<Array<CalendarItemWithOccurrences & { dueDateLocalYmd: string }>> {
    if (!this.db) {
      console.warn(
        "getCalendarItems called while storage DB is not initialized (SKIP_STORAGE_INIT). Returning empty list."
      );
      return [];
    }
    
    // ✅ FIXED: Fetch full recurrence metadata by joining with source tables
    const startDateStr = toISTDateString(startDate);
    const endDateStr = toISTDateString(endDate);
    
    console.log(`📅 Fetching DB-driven calendar occurrences for range ${startDateStr} to ${endDateStr}`);
    
    // Query occurrence_reminders and LEFT JOIN with source tables to get recurrence_data
    const query = sql`
      SELECT DISTINCT
        o.occurrence_key,
        o.entity_type,
        o.entity_id,
        o.task_title,
        o.due_date_local_ymd,
        o.occurrence_task_utc,
        o.task_status,
        -- Join with original tables to get recurrence data and real master status
        COALESCE(vi.recurrence_data, ai.recurrence_data, tl.recurrence_data, ta.recurrence_data) as recurrence_data,
        COALESCE(vi.is_recurring, ai.is_recurring, tl.is_recurring, ta.is_recurring, false) as is_recurring
      FROM occurrence_reminders o
      LEFT JOIN vehicle_items vi ON o.entity_type = 'vehicle_item' AND o.entity_id = vi.id
      LEFT JOIN asset_items ai ON o.entity_type = 'asset_item' AND o.entity_id = ai.id
      LEFT JOIN tax_legal_items tl ON o.entity_type = 'tax_legal_item' AND o.entity_id = tl.id
      LEFT JOIN task_action_items ta ON o.entity_type = 'task_action_item' AND o.entity_id = ta.id
      WHERE o.user_id = ${userId}
        AND o.due_date_local_ymd >= ${startDateStr}
        AND o.due_date_local_ymd <= ${endDateStr}
      ORDER BY o.due_date_local_ymd ASC, o.occurrence_task_utc ASC;
    `;
    
    const result = await this.dbx.execute(query);
    const rows = (result.rows ?? result) as any[];
    
    console.log(`✅ Loaded ${rows.length} occurrence(s) from DB with full recurrence metadata`);
    
    return rows.map((occ: any) => {
      const isRecurring = Boolean(occ.is_recurring);
      
      // Map entity types to calendar entity types
      const entityType = (() => {
        switch (occ.entity_type) {
          case "vehicle_item": return "vehicle" as const;
          case "asset_item": return "asset" as const;
          case "tax_legal_item": return "tax_legal_item" as const;
          case "task_action_item": return "task_action_item" as const;
          case "calendar_event": return "event" as const;
          default: return "event" as const;
        }
      })();
      
      return {
        id: isRecurring ? occ.occurrence_key : occ.entity_id,
        title: occ.task_title,
        dueDate: new Date(occ.occurrence_task_utc),
        category: "",
        status: occ.task_status,
        entityType,
        vehicleId: null,
        vehicleName: null,
        recurrenceData: occ.recurrence_data,
        isRecurringOccurrence: isRecurring,
        seriesMasterId: isRecurring ? occ.entity_id : null,
        occurrenceTaskDateUtcIso: new Date(occ.occurrence_task_utc).toISOString(),
        dueDateLocalYmd: occ.due_date_local_ymd,
      };
    });
  }

  /**
   * Mark specific recipients (or all failed recipients) as expired for an occurrence reminder
   * This is used by the "Mark as read" action in the missed reminders UI
   */
  async markOccurrenceReminderRecipientsExpired(args: {
    userId: string;
    occurrenceReminderId: string;
    recipientKeys?: string[];
  }): Promise<{ updatedRecipients: string[] }> {
    const { userId, occurrenceReminderId, recipientKeys } = args;
    const nowIso = new Date().toISOString();

    // Fetch the occurrence reminder row
    const rows = await this.dbx
      .select({
        id: occurrenceReminders.id,
        userId: occurrenceReminders.userId,
        recipientStatus: occurrenceReminders.recipientStatus,
      })
      .from(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.id, occurrenceReminderId),
          eq(occurrenceReminders.userId, userId)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      throw new Error('Occurrence reminder not found or unauthorized');
    }

    const row = rows[0];
    const currentRecipientStatus = (row.recipientStatus || {}) as Record<string, any>;
    
    // Determine which recipients to update
    const keysToUpdate: string[] = recipientKeys && recipientKeys.length > 0
      ? recipientKeys
      : Object.keys(currentRecipientStatus).filter(
          key => currentRecipientStatus[key]?.status === 'failed'
        );

    if (keysToUpdate.length === 0) {
      return { updatedRecipients: [] };
    }

    // Build updated recipient_status
    const updatedRecipientStatus = { ...currentRecipientStatus };
    
    for (const key of keysToUpdate) {
      const existing = updatedRecipientStatus[key] || {};
      updatedRecipientStatus[key] = {
        ...existing,
        status: 'expired',
        last_error: 'expired (mark as read)',
        last_attempt_at: nowIso,
        next_retry_at: null,
      };
    }

    // Update the row
    await this.dbx
      .update(occurrenceReminders)
      .set({
        recipientStatus: updatedRecipientStatus,
        updatedAt: sql`now()`,
      })
      .where(eq(occurrenceReminders.id, occurrenceReminderId));

    return { updatedRecipients: keysToUpdate };
  }

  async getOpenMissedRemindersForUser(
    userId: string
  ): Promise<MissedReminderDTO[]> {
    if (!userId) {
      return [];
    }

    // ⭐ NEW: Query occurrence_reminders table (source of truth)
    const result = await this.dbx.execute<any>(sql`
      SELECT 
        id,
        user_id,
        entity_type,
        entity_id,
        task_title,
        due_date_local_ymd,
        reminder_at_utc::text as reminder_at_utc,
        reminder_channel,
        recipient_status
      FROM occurrence_reminders
      WHERE user_id = ${userId}
        AND reminder_channel = 'email'
        -- Filter rows that have at least one 'failed' recipient
        AND EXISTS (
          SELECT 1
          FROM jsonb_each(recipient_status) e(key, value)
          WHERE (value->>'status') = 'failed'
        )
      ORDER BY reminder_at_utc DESC NULLS LAST
      LIMIT 50
    `);

    const rows = Array.isArray((result as any)?.rows)
      ? (result as any).rows
      : Array.isArray(result)
      ? result
      : [];

    // Flatten: one DTO per failed recipient
    const dtos: MissedReminderDTO[] = [];
    
    for (const row of rows) {
      const recipientStatus = row.recipient_status || {};
      
      for (const [recipientKey, statusObj] of Object.entries(recipientStatus as Record<string, any>)) {
        const status = statusObj?.status || 'pending';
        
        // Only include failed recipients (not expired, not sent, not pending)
        if (status !== 'failed') {
          continue;
        }
        
        // Parse reminder_at_utc - it comes as ISO string from SQL cast
        const reminderAtUtc = row.reminder_at_utc 
          ? (row.reminder_at_utc instanceof Date 
              ? row.reminder_at_utc.toISOString() 
              : new Date(row.reminder_at_utc).toISOString())
          : null;

        dtos.push({
          reminderId: row.id, // Using occurrence_reminder id as reminderId
          occurrenceNumber: 1, // Not used in new system but kept for compatibility
          recipientEmail: recipientKey,
          userId: row.user_id,
          entityType: row.entity_type,
          entityId: row.entity_id,
          taskTitle: row.task_title,
          taskCategory: null,
          scheduleType: null, // Not stored in occurrence_reminders
          reminderDateUtc: reminderAtUtc,
          attemptedAtUtc: statusObj?.last_attempt_at || null,
          status: 'failed',
          errorType: null, // Not separately stored
          errorMessage: statusObj?.last_error || null,
          emailSubject: null, // Not stored in occurrence_reminders
          acknowledgedByUser: false, // New system doesn't use this flag
        });
      }
    }

    return dtos;
  }

  // ⭐ NEW: occurrence_reminders methods
  async deleteOccurrenceRemindersByEntity(
    entityType: string,
    entityId: string
  ): Promise<void> {
    await this.dbx
      .delete(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.entityType, entityType),
          eq(occurrenceReminders.entityId, entityId)
        )
      );
  }

  async getPendingOccurrenceReminders(limit = 200): Promise<OccurrenceReminder[]> {
    // Fetch rows where reminder time is due and task is pending
    // AND at least one recipient is still eligible (not sent/expired)
    return await this.dbx
      .select()
      .from(occurrenceReminders)
      .where(
        and(
          lte(occurrenceReminders.reminderAtUtc, new Date()),
          eq(occurrenceReminders.taskStatus, 'pending'),
          // Only rows where at least one recipient is NOT sent/expired
          sql`EXISTS (
            SELECT 1
            FROM jsonb_each(${occurrenceReminders.recipientStatus}) AS e(key, value)
            WHERE COALESCE(value->>'status','pending') IN ('pending','failed','sending')
          )`
        )
      )
      .orderBy(asc(occurrenceReminders.reminderAtUtc))
      .limit(limit);
  }

  async getOccurrenceRemindersByEntity(args: {
    userId: string;
    entityType: string;
    entityId: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
    direction?: 'next' | 'prev';
    fetchAll?: boolean;
  }): Promise<{
    items: Array<{
      occurrenceKey: string;
      occurrenceTaskUtc: string;
      dueDateLocalYmd: string;
      taskTitle: string;
      taskStatus: string;
      completedAt: string | null;
      earliestReminderAtUtc: string | null;
      lastAttemptAt: string | null;
      recipients: Array<{
        channel: string | null;
        recipient: string | null;
        reminderAtUtc: string | null;
        reminderStatus: string;
        attemptCount: number | null;
        lastAttemptAt: string | null;
        lastError: string | null;
        messageId: string | null;
      }>;
    }>;
    nextCursor: string | null;
    prevCursor: string | null;
  }> {
    const { userId, entityType, entityId, from, to, cursor, direction = 'next', fetchAll = false } = args;
    const limitOccurrences = Math.min(args.limit || 10, 50);
    
    // ========== FETCH ALL MODE (No pagination, no date windows) ==========
    if (fetchAll) {
      const fetchAllLimit = args.limit || 500;
      
      // Base conditions only (no date filters)
      const baseConditions = [
        eq(occurrenceReminders.userId, userId),
        eq(occurrenceReminders.entityType, entityType),
        eq(occurrenceReminders.entityId, entityId),
      ];
      
      // Fetch distinct occurrence keys ordered by task date ASC
      const allKeys = await this.dbx
        .select({
          occurrenceKey: occurrenceReminders.occurrenceKey,
          occurrenceTaskUtc: occurrenceReminders.occurrenceTaskUtc,
        })
        .from(occurrenceReminders)
        .where(and(...baseConditions))
        .groupBy(occurrenceReminders.occurrenceKey, occurrenceReminders.occurrenceTaskUtc)
        .orderBy(
          asc(occurrenceReminders.occurrenceTaskUtc),
          asc(occurrenceReminders.occurrenceKey)
        )
        .limit(fetchAllLimit);
      
      if (allKeys.length === 0) {
        return {
          items: [],
          nextCursor: null,
          prevCursor: null,
        };
      }
      
      // Fetch full rows for all occurrence keys
      const selectedKeys = allKeys.map(k => k.occurrenceKey);
      
      const rows = await this.dbx
        .select()
        .from(occurrenceReminders)
        .where(
          and(
            ...baseConditions,
            inArray(occurrenceReminders.occurrenceKey, selectedKeys)
          )
        )
        .orderBy(
          asc(occurrenceReminders.occurrenceTaskUtc),
          asc(occurrenceReminders.occurrenceKey),
          asc(occurrenceReminders.reminderAtUtc)
        );
      
      // Group by occurrence_key
      const grouped = new Map<string, typeof rows>();
      rows.forEach((row) => {
        if (!grouped.has(row.occurrenceKey)) {
          grouped.set(row.occurrenceKey, []);
        }
        grouped.get(row.occurrenceKey)!.push(row);
      });
      
      // Build items in the EXACT order of allKeys
      const items = allKeys.map((keyInfo) => {
        const occRows = grouped.get(keyInfo.occurrenceKey) || [];
        const firstRow = occRows[0];
        
        if (!firstRow) {
          return {
            occurrenceKey: keyInfo.occurrenceKey,
            occurrenceTaskUtc: keyInfo.occurrenceTaskUtc.toISOString(),
            dueDateLocalYmd: '',
            taskTitle: '',
            taskStatus: 'pending',
            completedAt: null,
            earliestReminderAtUtc: null,
            lastAttemptAt: null,
            recipients: [],
          };
        }
        
        // Find earliest reminder date
        const reminderDates = occRows.map(r => r.reminderAtUtc).filter(Boolean);
        const earliestReminder = reminderDates.length > 0 
          ? reminderDates.reduce((min, d) => (d! < min! ? d : min))
          : null;
        
        // Extract recipients from recipientStatus JSONB across all channels
        const recipients: Array<{
          channel: string | null;
          recipient: string | null;
          reminderAtUtc: string | null;
          reminderStatus: string;
          attemptCount: number | null;
          lastAttemptAt: string | null;
          lastError: string | null;
          messageId: string | null;
        }> = [];
        
        for (const row of occRows) {
          const recipientStatus = row.recipientStatus as Record<string, any>;
          for (const [recipientKey, statusObj] of Object.entries(recipientStatus)) {
            recipients.push({
              channel: row.reminderChannel,
              recipient: recipientKey,
              reminderAtUtc: row.reminderAtUtc?.toISOString() || null,
              reminderStatus: statusObj.status || 'pending',
              attemptCount: statusObj.attempts || 0,
              lastAttemptAt: statusObj.last_attempt_at || null,
              lastError: statusObj.last_error || null,
              messageId: statusObj.message_id || null,
            });
          }
        }
        
        // Find last attempt from any recipient
        const lastAttemptTimes = recipients
          .map(r => r.lastAttemptAt)
          .filter(Boolean)
          .map(t => new Date(t!));
        const lastAttempt = lastAttemptTimes.length > 0
          ? lastAttemptTimes.reduce((max, d) => (d > max ? d : max))
          : null;
        
        return {
          occurrenceKey: keyInfo.occurrenceKey,
          occurrenceTaskUtc: firstRow.occurrenceTaskUtc.toISOString(),
          dueDateLocalYmd: firstRow.dueDateLocalYmd,
          taskTitle: firstRow.taskTitle,
          taskStatus: firstRow.taskStatus,
          completedAt: firstRow.completedAt?.toISOString() || null,
          earliestReminderAtUtc: earliestReminder?.toISOString() || null,
          lastAttemptAt: lastAttempt?.toISOString() || null,
          recipients,
        };
      });
      
      return {
        items,
        nextCursor: null,
        prevCursor: null,
      };
    }
    
    // ========== STANDARD PAGINATED MODE (existing behavior) ==========
    
    // Parse cursor if provided (format: base64({ t: ISO, k: key }))
    let cursorTaskUtc: Date | null = null;
    let cursorKey: string | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
        cursorTaskUtc = new Date(decoded.t);
        cursorKey = decoded.k;
      } catch (e) {
        // Invalid cursor, ignore
      }
    }

    // Build base conditions (used for all queries)
    const baseConditions = [
      eq(occurrenceReminders.userId, userId),
      eq(occurrenceReminders.entityType, entityType),
      eq(occurrenceReminders.entityId, entityId),
    ];

    // Add date window filters
    if (from) {
      baseConditions.push(gte(occurrenceReminders.occurrenceTaskUtc, new Date(from)));
    }
    if (to) {
      baseConditions.push(lte(occurrenceReminders.occurrenceTaskUtc, new Date(to)));
    }

    // ========== STEP A: Paginate occurrenceKeys (distinct occurrences) ==========
    
    const keyConditions = [...baseConditions];
    
    // Add keyset pagination (tuple comparison)
    if (cursorTaskUtc && cursorKey) {
      if (direction === 'next') {
        // Fetch next: (occurrence_task_utc, occurrence_key) > (cursor_t, cursor_k)
        keyConditions.push(
          or(
            gt(occurrenceReminders.occurrenceTaskUtc, cursorTaskUtc),
            and(
              eq(occurrenceReminders.occurrenceTaskUtc, cursorTaskUtc),
              gt(occurrenceReminders.occurrenceKey, cursorKey)
            )
          )!
        );
      } else {
        // Fetch prev: (occurrence_task_utc, occurrence_key) < (cursor_t, cursor_k)
        keyConditions.push(
          or(
            lt(occurrenceReminders.occurrenceTaskUtc, cursorTaskUtc),
            and(
              eq(occurrenceReminders.occurrenceTaskUtc, cursorTaskUtc),
              lt(occurrenceReminders.occurrenceKey, cursorKey)
            )
          )!
        );
      }
    }

    // Fetch distinct occurrence keys (limit+1 to detect hasMore)
    // Use GROUP BY to get distinct keys with their task UTC
    const keyQuery = this.dbx
      .select({
        occurrenceKey: occurrenceReminders.occurrenceKey,
        occurrenceTaskUtc: occurrenceReminders.occurrenceTaskUtc,
      })
      .from(occurrenceReminders)
      .where(and(...keyConditions))
      .groupBy(occurrenceReminders.occurrenceKey, occurrenceReminders.occurrenceTaskUtc);

    // Order based on direction
    if (direction === 'next') {
      keyQuery.orderBy(
        asc(occurrenceReminders.occurrenceTaskUtc),
        asc(occurrenceReminders.occurrenceKey)
      );
    } else {
      keyQuery.orderBy(
        desc(occurrenceReminders.occurrenceTaskUtc),
        desc(occurrenceReminders.occurrenceKey)
      );
    }

    const keysWithExtra = await keyQuery.limit(limitOccurrences + 1);

    // Detect if there are more pages
    const hasMore = keysWithExtra.length > limitOccurrences;
    let pageKeys = keysWithExtra.slice(0, limitOccurrences);

    // If direction=prev, reverse to get chronological (ASC) order
    if (direction === 'prev') {
      pageKeys = pageKeys.reverse();
    }

    // If no keys, return empty result
    if (pageKeys.length === 0) {
      return {
        items: [],
        nextCursor: null,
        prevCursor: null,
      };
    }

    // ========== STEP B: Fetch full rows for those occurrenceKeys ==========
    
    const selectedKeys = pageKeys.map(k => k.occurrenceKey);
    
    const rows = await this.dbx
      .select()
      .from(occurrenceReminders)
      .where(
        and(
          ...baseConditions,
          inArray(occurrenceReminders.occurrenceKey, selectedKeys)
        )
      )
      .orderBy(
        asc(occurrenceReminders.occurrenceTaskUtc),
        asc(occurrenceReminders.occurrenceKey),
        asc(occurrenceReminders.reminderAtUtc)
      );

    // Group by occurrence_key
    const grouped = new Map<string, typeof rows>();
    rows.forEach((row) => {
      if (!grouped.has(row.occurrenceKey)) {
        grouped.set(row.occurrenceKey, []);
      }
      grouped.get(row.occurrenceKey)!.push(row);
    });

    // Build items in the EXACT order of pageKeys
    const items = pageKeys.map((keyInfo) => {
      const occRows = grouped.get(keyInfo.occurrenceKey) || [];
      const firstRow = occRows[0];
      
      if (!firstRow) {
        // Should not happen, but handle gracefully
        return {
          occurrenceKey: keyInfo.occurrenceKey,
          occurrenceTaskUtc: keyInfo.occurrenceTaskUtc.toISOString(),
          dueDateLocalYmd: '',
          taskTitle: '',
          taskStatus: 'pending',
          completedAt: null,
          earliestReminderAtUtc: null,
          lastAttemptAt: null,
          recipients: [],
        };
      }
      
      // Find earliest reminder date
      const reminderDates = occRows.map(r => r.reminderAtUtc).filter(Boolean);
      const earliestReminder = reminderDates.length > 0 
        ? reminderDates.reduce((min, d) => (d! < min! ? d : min))
        : null;
      
      // Extract recipients from recipientStatus JSONB across all channels
      const recipients: Array<{
        channel: string | null;
        recipient: string | null;
        reminderAtUtc: string | null;
        reminderStatus: string;
        attemptCount: number | null;
        lastAttemptAt: string | null;
        lastError: string | null;
        messageId: string | null;
      }> = [];
      
      for (const row of occRows) {
        const recipientStatus = row.recipientStatus as Record<string, any>;
        for (const [recipientKey, statusObj] of Object.entries(recipientStatus)) {
          recipients.push({
            channel: row.reminderChannel,
            recipient: recipientKey,
            reminderAtUtc: row.reminderAtUtc?.toISOString() || null,
            reminderStatus: statusObj.status || 'pending',
            attemptCount: statusObj.attempts || 0,
            lastAttemptAt: statusObj.last_attempt_at || null,
            lastError: statusObj.last_error || null,
            messageId: statusObj.message_id || null,
          });
        }
      }
      
      // Find last attempt from any recipient
      const lastAttemptTimes = recipients
        .map(r => r.lastAttemptAt)
        .filter(Boolean)
        .map(t => new Date(t!));
      const lastAttempt = lastAttemptTimes.length > 0
        ? lastAttemptTimes.reduce((max, d) => (d > max ? d : max))
        : null;
      
      return {
        occurrenceKey: keyInfo.occurrenceKey,
        occurrenceTaskUtc: firstRow.occurrenceTaskUtc.toISOString(),
        dueDateLocalYmd: firstRow.dueDateLocalYmd,
        taskTitle: firstRow.taskTitle,
        taskStatus: firstRow.taskStatus,
        completedAt: firstRow.completedAt?.toISOString() || null,
        earliestReminderAtUtc: earliestReminder?.toISOString() || null,
        lastAttemptAt: lastAttempt?.toISOString() || null,
        recipients,
      };
    });

    // ========== STEP C: Correct cursor semantics with existence checks ==========
    
    const firstItem = items[0];
    const lastItem = items[items.length - 1];

    // Helper to create cursor
    const makeCursor = (item: typeof items[0]) => {
      return Buffer.from(JSON.stringify({
        t: item.occurrenceTaskUtc,
        k: item.occurrenceKey,
      })).toString('base64');
    };

    // Check if there are earlier occurrences (for prevCursor)
    const hasEarlierConditions = [
      ...baseConditions,
      or(
        lt(occurrenceReminders.occurrenceTaskUtc, new Date(firstItem.occurrenceTaskUtc)),
        and(
          eq(occurrenceReminders.occurrenceTaskUtc, new Date(firstItem.occurrenceTaskUtc)),
          lt(occurrenceReminders.occurrenceKey, firstItem.occurrenceKey)
        )
      )!
    ];

    const earlierExists = await this.dbx
      .select({ occurrenceKey: occurrenceReminders.occurrenceKey })
      .from(occurrenceReminders)
      .where(and(...hasEarlierConditions))
      .limit(1);

    const hasEarlier = earlierExists.length > 0;

    // Check if there are later occurrences (for nextCursor)
    const hasLaterConditions = [
      ...baseConditions,
      or(
        gt(occurrenceReminders.occurrenceTaskUtc, new Date(lastItem.occurrenceTaskUtc)),
        and(
          eq(occurrenceReminders.occurrenceTaskUtc, new Date(lastItem.occurrenceTaskUtc)),
          gt(occurrenceReminders.occurrenceKey, lastItem.occurrenceKey)
        )
      )!
    ];

    const laterExists = await this.dbx
      .select({ occurrenceKey: occurrenceReminders.occurrenceKey })
      .from(occurrenceReminders)
      .where(and(...hasLaterConditions))
      .limit(1);

    const hasLater = laterExists.length > 0;

    // Set cursors based on existence
    const prevCursor = hasEarlier ? makeCursor(firstItem) : null;
    const nextCursor = hasLater ? makeCursor(lastItem) : null;

    return {
      items,
      nextCursor,
      prevCursor,
    };
  }

  async claimOccurrenceReminderRecipient(args: {
    id: string;
    recipientKey: string;
  }): Promise<{ ok: boolean; sendToken: string }> {
    const sendToken = crypto.randomUUID();
    const claimedAtIso = new Date().toISOString();

    const result = await this.dbx.execute(sql`
      UPDATE occurrence_reminders
      SET
        recipient_status = jsonb_set(
          recipient_status,
          ARRAY[${args.recipientKey}::text]::text[],
          COALESCE(
            recipient_status -> (${args.recipientKey}::text),
            '{}'::jsonb
          ) || jsonb_build_object(
            'status', 'sending',
            'send_token', ${sendToken}::text,
            'claimed_at', ${claimedAtIso}::timestamptz
          ),
          true
        ),
        updated_at = now()
      WHERE id = ${args.id}
        AND (
          (recipient_status -> (${args.recipientKey}::text)) IS NULL
          OR (recipient_status -> (${args.recipientKey}::text) ->> 'status') IS NULL
          OR (recipient_status -> (${args.recipientKey}::text) ->> 'status') IN ('pending','failed')
          -- IMPORTANT: allow retry if "sending" is stuck for too long (15 mins here)
          OR (
            (recipient_status -> (${args.recipientKey}::text) ->> 'status') = 'sending'
            AND COALESCE(
              (recipient_status -> (${args.recipientKey}::text) ->> 'claimed_at')::timestamptz,
              'epoch'::timestamptz
            ) < (now() - interval '15 minutes')
          )
        )
    `);

    const rowCount = (result as any)?.rowCount ?? 0;
    return { ok: rowCount > 0, sendToken };
  }

  async finalizeOccurrenceReminderRecipientAttempt(args: {
    id: string;
    recipientKey: string;
    sendToken: string;
    didSucceed: boolean;
    messageId?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    const nowIso = new Date().toISOString();

    await this.dbx.execute(sql`
      UPDATE occurrence_reminders
      SET
        recipient_status = jsonb_set(
          recipient_status,
          ARRAY[${args.recipientKey}::text]::text[],
          jsonb_build_object(
            'status', CASE WHEN ${args.didSucceed}::boolean THEN 'sent' ELSE 'failed' END,
            'attempts', COALESCE((recipient_status -> (${args.recipientKey}::text) ->> 'attempts')::int, 0) + 1,
            'last_attempt_at', ${nowIso}::timestamptz,
            'last_error', ${args.errorMessage ?? null}::text,
            'message_id', ${args.messageId ?? null}::text,
            'send_token', ${args.sendToken}::text
          ),
          true
        ),
        updated_at = now()
      WHERE id = ${args.id}
        AND (recipient_status -> (${args.recipientKey}::text) ->> 'send_token') = ${args.sendToken}::text
    `);
  }

  async expireOccurrenceReminderRecipients(args: {
    id: string;
    nowIso: string;
  }): Promise<void> {
    await this.dbx.execute(sql`
      UPDATE occurrence_reminders
      SET
        recipient_status = (
          SELECT jsonb_object_agg(
            key,
            CASE
              WHEN value->>'status' = 'sent' THEN value
              ELSE value || jsonb_build_object(
                'status', 'expired',
                'last_attempt_at', ${args.nowIso}::timestamptz,
                'last_error', 'expired (past due)'
              )
            END
          )
          FROM jsonb_each(recipient_status)
        ),
        updated_at = now()
      WHERE id = ${args.id}
    `);
  }

  async completeOccurrenceByKey(args: {
    userId: string;
    occurrenceKey: string;
    note?: string | null;
  }): Promise<{ rowsUpdated: number }> {
    const now = new Date();
    // This completes ALL rows for that occurrenceKey (e.g., email + whatsapp channels)
    // Only updates pending rows (idempotent - won't re-complete already completed)
    const updated = await this.dbx
      .update(occurrenceReminders)
      .set({
        taskStatus: "completed",
        completedAt: now,
        taskNote: args.note ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(occurrenceReminders.userId, args.userId),
          eq(occurrenceReminders.occurrenceKey, args.occurrenceKey),
          eq(occurrenceReminders.taskStatus, "pending") // 👈 Idempotent: only pending rows
        )
      )
      .returning({ id: occurrenceReminders.id });
    
    return { rowsUpdated: updated.length };
  }

  // Used to decide "already completed" vs "doesn't exist" vs "not pending"
  async getOccurrenceKeyAggregate(args: {
    userId: string;
    occurrenceKey: string;
  }): Promise<{ total: number; completed: number; pending: number; skipped: number }> {
    const { rows } = await this.dbx.execute<{
      total: number;
      completed: number;
      pending: number;
      skipped: number;
    }>(sql`
      select
        count(*)::int as total,
        sum(case when task_status = 'completed' then 1 else 0 end)::int as completed,
        sum(case when task_status = 'pending' then 1 else 0 end)::int as pending,
        sum(case when task_status = 'skipped' then 1 else 0 end)::int as skipped
      from occurrence_reminders
      where user_id = ${args.userId} and occurrence_key = ${args.occurrenceKey}
    `);

    return rows?.[0] ?? { total: 0, completed: 0, pending: 0, skipped: 0 };
  }

  async materializeOccurrenceRemindersForEntity(params: {
    userId: string;
    entityType: string;
    entityId: string;
    taskTitle: string;
    isRecurring: boolean;
    dueDateYmd: string;
    nextDueDateYmd?: string | null;
    recurrenceData: any;
    reminderOffsetValue: number;
    reminderOffsetUnit: string;
    notificationChannels: string[];
    emailRecipients: string[];
    whatsappRecipients: string[];
    smsRecipients: string[];
    reminderTimes: string[];
  }): Promise<void> {
    // Delete existing reminders
    await this.deleteOccurrenceRemindersByEntity(params.entityType, params.entityId);

    // Compute occurrences
    const occurrenceTaskUtcs: Date[] = [];

    if (!params.isRecurring) {
      occurrenceTaskUtcs.push(computeOccurrenceTaskUtcFromEntity(params.dueDateYmd, params.reminderTimes));
    } else {
      const { getNextOccurrence } = await import('@shared/recurrence-calculator');
      const startDateYmd = params.nextDueDateYmd || params.dueDateYmd;
      let current = computeOccurrenceTaskUtcFromEntity(startDateYmd, params.reminderTimes);
      
      const recData = params.recurrenceData;
      const endType = recData?.endType;
      const MAX_OCCURRENCES_CAP = 200;
      let maxOccurrences = MAX_OCCURRENCES_CAP;

      if (endType === 'after' && recData.endCount) {
        maxOccurrences = Math.min(recData.endCount, MAX_OCCURRENCES_CAP);
      } else if (endType === 'never') {
        maxOccurrences = MAX_OCCURRENCES_CAP;
      } else if ((endType === 'on' || endType === 'onDate') && recData.endDate) {
        const endDate = new Date(recData.endDate);
        for (let i = 0; i < 500; i++) {
          if (current > endDate) break;
          occurrenceTaskUtcs.push(new Date(current));
          current = getNextOccurrence(current, recData);
        }
        maxOccurrences = 0; // Already processed
      }

      if (maxOccurrences > 0) {
        for (let i = 0; i < maxOccurrences; i++) {
          occurrenceTaskUtcs.push(new Date(current));
          current = getNextOccurrence(current, recData);
        }
      }
    }

    // Create reminders: 1 row per (occurrence, channel) with all recipients in JSON
    const rows: InsertOccurrenceReminder[] = [];

    for (const occurrenceTaskUtc of occurrenceTaskUtcs) {
      const occurrenceKey = makeOccurrenceKey(params.entityId, occurrenceTaskUtc);
      const dueDateLocalYmd = toLocalYmdIST(occurrenceTaskUtc);
      const reminderAtUtc = computeReminderAtUtc(
        occurrenceTaskUtc,
        params.reminderOffsetValue,
        params.reminderOffsetUnit,
        params.reminderTimes
      );

      // Email channel
      if (params.notificationChannels.includes('email') && params.emailRecipients.length > 0) {
        const recipientStatus: Record<string, any> = {};
        for (const recipient of params.emailRecipients) {
          recipientStatus[recipient] = {
            status: 'pending',
            attempts: 0,
            last_attempt_at: null,
            last_error: null,
            message_id: null,
            next_retry_at: reminderAtUtc.toISOString(),
          };
        }
        rows.push({
          userId: params.userId,
          entityType: params.entityType,
          entityId: params.entityId,
          occurrenceTaskUtc,
          occurrenceKey,
          taskStatus: 'pending',
          dueDateLocalYmd,
          reminderAtUtc,
          reminderChannel: 'email',
          recipientStatus,
          taskTitle: params.taskTitle,
        } as InsertOccurrenceReminder);
      }

      // WhatsApp channel
      if (params.notificationChannels.includes('whatsapp') && params.whatsappRecipients.length > 0) {
        const recipientStatus: Record<string, any> = {};
        for (const recipient of params.whatsappRecipients) {
          recipientStatus[recipient] = {
            status: 'pending',
            attempts: 0,
            last_attempt_at: null,
            last_error: null,
            message_id: null,
            next_retry_at: reminderAtUtc.toISOString(),
          };
        }
        rows.push({
          userId: params.userId,
          entityType: params.entityType,
          entityId: params.entityId,
          occurrenceTaskUtc,
          occurrenceKey,
          taskStatus: 'pending',
          dueDateLocalYmd,
          reminderAtUtc,
          reminderChannel: 'whatsapp',
          recipientStatus,
          taskTitle: params.taskTitle,
        } as InsertOccurrenceReminder);
      }

      // SMS channel (skip for now if DB doesn't support - check constraint)
      // if (params.notificationChannels.includes('sms') && params.smsRecipients.length > 0) {
      //   // Not materializing SMS until DB constraint allows it
      // }
    }

    if (rows.length > 0) {
      await this.dbx.insert(occurrenceReminders).values(rows).onConflictDoNothing();
    }
  }

  /**
   * Sync title and/or email_recipients to FUTURE pending occurrence reminders only.
   * Does NOT recreate reminders; only updates existing future ones.
   */
  async syncFutureOccurrenceRemindersForEntity(params: {
    userId: string;
    entityType: string;
    entityId: string;
    newTitle?: string;
    newEmailRecipients?: string[];
  }): Promise<void> {
    const { userId, entityType, entityId, newTitle, newEmailRecipients } = params;

    // Normalize new emails: trim, lowercase, deduplicate
    const normalizedNewEmails = newEmailRecipients
      ? Array.from(
          new Set(
            newEmailRecipients
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e.length > 0)
          )
        )
      : undefined;

    // Select future pending email reminders
    const futureRows = await this.dbx
      .select()
      .from(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.userId, userId),
          eq(occurrenceReminders.entityType, entityType),
          eq(occurrenceReminders.entityId, entityId),
          eq(occurrenceReminders.taskStatus, 'pending'),
          isNull(occurrenceReminders.completedAt),
          sql`${occurrenceReminders.reminderAtUtc} > NOW()`,
          eq(occurrenceReminders.reminderChannel, 'email')
        )
      );

    if (futureRows.length === 0) {
      return; // No future reminders to sync
    }

    // Update each row
    for (const row of futureRows) {
      const updates: any = {};
      let needsUpdate = false;

      // Update title if provided
      if (newTitle !== undefined && row.taskTitle !== newTitle) {
        updates.taskTitle = newTitle;
        needsUpdate = true;
      }

      // Update recipient_status if emails provided
      if (normalizedNewEmails !== undefined) {
        const existingStatus = (row.recipientStatus as any) || {};
        const reconciledStatus = this.reconcileRecipientStatusForFutureRow(
          existingStatus,
          normalizedNewEmails,
          row.reminderAtUtc.toISOString()
        );

        // Check if reconciled differs from existing
        if (JSON.stringify(existingStatus) !== JSON.stringify(reconciledStatus)) {
          updates.recipientStatus = reconciledStatus;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        updates.updatedAt = sql`now()`;
        await this.dbx
          .update(occurrenceReminders)
          .set(updates)
          .where(eq(occurrenceReminders.id, row.id));
      }
    }
  }

  /**
   * Helper: Reconcile recipient_status for a single future reminder row.
   * Preserves existing recipient entries that have history (last_attempt_at not null).
   * Adds new recipients, removes pending recipients not in new list.
   */
  private reconcileRecipientStatusForFutureRow(
    existingStatus: Record<string, any>,
    newEmails: string[],
    reminderAtUtcISO: string
  ): Record<string, any> {
    const reconciled: Record<string, any> = {};

    // Add new recipients or keep existing
    for (const email of newEmails) {
      if (existingStatus[email]) {
        // Keep existing entry as-is
        reconciled[email] = existingStatus[email];
      } else {
        // Add new recipient
        reconciled[email] = {
          status: 'pending',
          attempts: 0,
          last_error: null,
          message_id: null,
          next_retry_at: reminderAtUtcISO,
          last_attempt_at: null,
        };
      }
    }

    // Keep old recipients that have history (last_attempt_at not null)
    for (const [email, entry] of Object.entries(existingStatus)) {
      if (!newEmails.includes(email)) {
        // Not in new list
        if (entry.last_attempt_at === null && entry.status === 'pending') {
          // Remove: no history, still pending
          continue;
        } else {
          // Keep: has history or non-pending
          reconciled[email] = entry;
        }
      }
    }

    return reconciled;
  }

  /**
   * Delete occurrence reminders for a specific entity
   * Used when deleting parent entities (vehicle_item, asset_item, task_action_item, tax_legal_item)
   * Even though DB triggers handle this, we explicitly delete for:
   * - Deterministic behavior
   * - Multi-tenant safety
   * - Testability
   */
  async deleteOccurrenceRemindersForEntity(args: {
    userId: string;
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item';
    entityId: string;
  }): Promise<{ deletedCount: number }> {
    console.log(`🗑️  Deleting occurrence_reminders for ${args.entityType}:${args.entityId} (user: ${args.userId})`);
    
    const result = await this.dbx
      .delete(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.userId, args.userId),
          eq(occurrenceReminders.entityType, args.entityType),
          eq(occurrenceReminders.entityId, args.entityId)
        )
      );
    
    const deletedCount = (result as any).rowCount ?? 0;
    console.log(`   ✅ Deleted ${deletedCount} occurrence_reminders row(s)`);
    
    return { deletedCount };
  }

  /**
   * ✅ METADATA-ONLY EDIT: Get current recipients for a task
   * Returns email addresses from PARENT TABLE (canonical source) as primary,
   * with occurrence_reminders as fallback for backwards compatibility
   * 
   * ROOT CAUSE FIX #1: Previously only read from occurrence_reminders,
   * but parent table is the canonical source of truth.
   * 
   * ROOT CAUSE FIX #2: tax_legal_items stores recipients in customFields.emailRecipients
   * (since it lacks a dedicated emailRecipients column), while other tables use
   * the dedicated emailRecipients column.
   */
  async getCurrentRecipientsFromOccurrenceReminders(
    userId: string,
    entityType: string,
    entityId: string
  ): Promise<string[]> {
    // 1. PRIMARY SOURCE: Read from parent table's emailRecipients column
    // ✅ ALL entity types now use dedicated emailRecipients column (including tax_legal_items after migration)
    const parentTask = await this.getTaskByEntityType(entityType, entityId);
    const parentEmailRecipients = (parentTask as any)?.emailRecipients;
    
    if (parentEmailRecipients && Array.isArray(parentEmailRecipients) && parentEmailRecipients.length > 0) {
      console.log(`📧 Fetched ${parentEmailRecipients.length} recipients from parent table for ${entityType}:${entityId}`);
      return parentEmailRecipients.sort();
    }

    // 2. FALLBACK: Read from occurrence_reminders (for backwards compatibility)
    console.log(`📧 No recipients in parent table, checking occurrence_reminders for ${entityType}:${entityId}`);
    const now = new Date();
    
    // Try to get from nearest future pending reminder first
    const futureRows = await this.dbx
      .select({
        recipientStatus: occurrenceReminders.recipientStatus,
      })
      .from(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.userId, userId),
          eq(occurrenceReminders.entityType, entityType),
          eq(occurrenceReminders.entityId, entityId),
          eq(occurrenceReminders.taskStatus, 'pending'),
          isNull(occurrenceReminders.completedAt),
          gt(occurrenceReminders.reminderAtUtc, now)
        )
      )
      .orderBy(occurrenceReminders.reminderAtUtc)
      .limit(1);

    // Collect unique email addresses from recipient_status
    const emailsSet = new Set<string>();
    for (const row of futureRows) {
      const recipientStatus = row.recipientStatus as Record<string, any> || {};
      for (const email of Object.keys(recipientStatus)) {
        emailsSet.add(email);
      }
    }

    // If no future reminders found, try to get from the most recent reminder (even past/sent)
    if (emailsSet.size === 0) {
      const anyRows = await this.dbx
        .select({
          recipientStatus: occurrenceReminders.recipientStatus,
        })
        .from(occurrenceReminders)
        .where(
          and(
            eq(occurrenceReminders.userId, userId),
            eq(occurrenceReminders.entityType, entityType),
            eq(occurrenceReminders.entityId, entityId)
          )
        )
        .orderBy(desc(occurrenceReminders.reminderAtUtc))
        .limit(1);

      for (const row of anyRows) {
        const recipientStatus = row.recipientStatus as Record<string, any> || {};
        for (const email of Object.keys(recipientStatus)) {
          emailsSet.add(email);
        }
      }
    }

    console.log(`📧 Fetched ${emailsSet.size} recipients from occurrence_reminders for ${entityType}:${entityId}`);
    return Array.from(emailsSet).sort();
  }

  /**
   * ✅ METADATA-ONLY EDIT: Update task metadata (title, contacts, recipients)
   * Updates parent task table and occurrence_reminders for future pending rows
   * 
   * ROOT CAUSE FIX #1: Previously only updated parent table for title/contacts,
   * but missed updating emailRecipients (canonical source of truth).
   * 
   * ROOT CAUSE FIX #2: tax_legal_items table does NOT have emailRecipients column,
   * so we must store recipients in customFields.emailRecipients for that table,
   * while other tables (vehicle_items, asset_items, task_action_items) have
   * a dedicated emailRecipients column.
   */
  /**
   * ✅ Compute email recipients editability status for a task
   * Returns eligibility info to decide if email recipients section should be locked
   */
  async getTaskRecipientsEditabilityStatus(
    userId: string,
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item',
    entityId: string
  ): Promise<{
    eligibleUpcomingUnsentCount: number;
    futureGenerationPossible: boolean;
    shouldLockEmailRecipients: boolean;
  }> {
    const now = new Date();
    
    // Count eligible upcoming unsent reminders
    const eligibleRows = await this.dbx
      .select({
        id: occurrenceReminders.id,
        recipientStatus: occurrenceReminders.recipientStatus,
      })
      .from(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.userId, userId),
          eq(occurrenceReminders.entityType, entityType),
          eq(occurrenceReminders.entityId, entityId),
          eq(occurrenceReminders.taskStatus, 'pending'),
          isNull(occurrenceReminders.completedAt),
          gt(occurrenceReminders.reminderAtUtc, now)
        )
      );

    // Count eligible recipients across all future pending rows
    let eligibleCount = 0;
    for (const row of eligibleRows) {
      const recipientStatus = row.recipientStatus as any;
      if (recipientStatus && typeof recipientStatus === 'object') {
        for (const email in recipientStatus) {
          const entry = recipientStatus[email];
          if (
            entry.status === 'pending' &&
            entry.attempts === 0 &&
            (entry.last_attempt_at === null || entry.last_attempt_at === undefined)
          ) {
            eligibleCount++;
          }
        }
      }
    }

    // Determine if future generation is possible
    const task = await this.getTaskByEntityType(entityType, entityId);
    const isRecurring = (task as any).isRecurring || (task as any).recurrenceData;
    let futureGenerationPossible = false;

    if (isRecurring) {
      const nextDueDate = (task as any).nextDueDate;
      const today = new Date().toISOString().split('T')[0];
      
      // Conservative rule: if recurring and has next_due_date >= today, future generation possible
      if (nextDueDate && nextDueDate >= today) {
        futureGenerationPossible = true;
      }
    }

    // Lock if no eligible reminders AND no future generation possible
    const shouldLockEmailRecipients = eligibleCount === 0 && !futureGenerationPossible;

    return {
      eligibleUpcomingUnsentCount: eligibleCount,
      futureGenerationPossible,
      shouldLockEmailRecipients,
    };
  }

  async updateTaskMetadata(
    userId: string,
    entityType: 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item',
    entityId: string,
    metadata: {
      title?: string;
      contacts?: Array<{ id: string; name: string; mobile: string; designation: string | null }>;
      recipients?: string[];
    }
  ): Promise<{ updatedRemindersCount: number }> {
    const { title, contacts, recipients } = metadata;

    // 1. Update parent task table (title, contacts, emailRecipients)
    if (title || contacts !== undefined || recipients) {
      const updateData: any = {};
      
      if (title) {
        updateData.title = title;
      }
      
      // ✅ Handle contacts: only update if explicitly provided (even if empty for explicit clear)
      if (contacts !== undefined) {
        // ✅ ALL entity types now use same structure after tax_legal_items migration
        const existingItem = await this.getTaskByEntityType(entityType, entityId);
        const existingCustomFields = (existingItem as any)?.customFields || {};
        
        // ✅ CRITICAL: Merge with existing customFields to preserve other keys
        // contacts === undefined -> do not change (not sent)
        // contacts === [] -> explicit clear (user removed all)
        // contacts === [...] -> update with new values
        updateData.customFields = {
          ...existingCustomFields,
          contacts,
        };
        
        console.log(`📝 Updating contacts for ${entityType}:${entityId}: ${contacts.length} contact(s)`);
      }
      
      // Recipients always go in dedicated emailRecipients column (ALL entity types)
      if (recipients) {
        updateData.emailRecipients = recipients;
      }

      await this.updateTaskByEntityType(entityType, entityId, updateData);
    }

    // 2. Update occurrence_reminders (title + recipients) for eligible future pending rows
    const result = await this.updateOccurrenceReminderMetadataForEntity({
      userId,
      entityType,
      entityId,
      title,
      emailRecipients: recipients,
    });

    return { updatedRemindersCount: result.updatedRows };
  }

  /**
   * ✅ METADATA-ONLY EDIT: Update occurrence_reminders metadata for eligible rows
   * Updates task_title and/or recipient_status for FUTURE pending reminders only
   */
  async updateOccurrenceReminderMetadataForEntity(args: {
    userId: string;
    entityType: string;
    entityId: string;
    title?: string;
    emailRecipients?: string[];
  }): Promise<{ updatedRows: number }> {
    const { userId, entityType, entityId, title, emailRecipients } = args;
    const now = new Date();

    // Fetch eligible reminder rows (future pending only)
    const eligibleRows = await this.dbx
      .select({
        id: occurrenceReminders.id,
        reminderAtUtc: occurrenceReminders.reminderAtUtc,
        recipientStatus: occurrenceReminders.recipientStatus,
      })
      .from(occurrenceReminders)
      .where(
        and(
          eq(occurrenceReminders.userId, userId),
          eq(occurrenceReminders.entityType, entityType),
          eq(occurrenceReminders.entityId, entityId),
          eq(occurrenceReminders.taskStatus, 'pending'),
          isNull(occurrenceReminders.completedAt),
          gt(occurrenceReminders.reminderAtUtc, now)
        )
      );

    console.log(`🔄 Updating occurrence_reminders metadata for ${eligibleRows.length} future pending reminders`);

    if (eligibleRows.length === 0) {
      console.log('   ℹ️ No eligible future pending reminders to update');
      return { updatedRows: 0 };
    }

    // Update each eligible row
    let updatedCount = 0;
    for (const row of eligibleRows) {
      const updateData: any = {};

      // Update task_title if provided
      if (title) {
        updateData.taskTitle = title;
      }

      // Update recipient_status if provided
      if (emailRecipients && emailRecipients.length > 0) {
        const existingRecipientStatus = (row.recipientStatus as Record<string, any>) || {};
        const newRecipientStatus: Record<string, any> = {};

        // Normalize new recipients
        const normalizedRecipients = emailRecipients
          .map(e => e.trim().toLowerCase())
          .filter(e => e.length > 0);
        const uniqueRecipients = Array.from(new Set(normalizedRecipients));

        // Reconcile recipient_status
        for (const [email, status] of Object.entries(existingRecipientStatus)) {
          // Keep entries that are already sent/failed/attempted
          // SAFETY: Never remove entries that have been attempted or are not pending
          if (status.status !== 'pending' || status.attempts > 0 || status.last_attempt_at !== null) {
            newRecipientStatus[email] = status;
          } else if (uniqueRecipients.includes(email)) {
            // Keep pending entries that are still in the new list
            newRecipientStatus[email] = status;
          }
          // Otherwise, remove (pending with attempts=0, no last_attempt_at, and not in new list)
        }

        // Add new recipients
        for (const email of uniqueRecipients) {
          if (!newRecipientStatus[email]) {
            newRecipientStatus[email] = {
              status: 'pending',
              attempts: 0,
              last_error: null,
              message_id: null,
              next_retry_at: row.reminderAtUtc.toISOString(),
              last_attempt_at: null,
            };
          }
        }

        updateData.recipientStatus = newRecipientStatus;
      }

      // Only update if there's something to change
      if (Object.keys(updateData).length > 0) {
        await this.dbx
          .update(occurrenceReminders)
          .set(updateData)
          .where(eq(occurrenceReminders.id, row.id));
        updatedCount++;
      }
    }

    console.log(`   ✅ Updated ${updatedCount} occurrence_reminders rows`);
    return { updatedRows: updatedCount };
  }

  /**
   * Helper: Get task by entity type
   */
  private async getTaskByEntityType(entityType: string, entityId: string): Promise<any> {
    switch (entityType) {
      case 'vehicle_item':
        return this.getVehicleItem(entityId);
      case 'asset_item':
        return this.getAssetItem(entityId);
      case 'task_action_item':
        return this.getTaskActionItem(entityId);
      case 'tax_legal_item':
        return this.getTaxLegalItem(entityId);
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  /**
   * Helper: Update task by entity type
   */
  private async updateTaskByEntityType(
    entityType: string,
    entityId: string,
    updateData: any
  ): Promise<void> {
    switch (entityType) {
      case 'vehicle_item':
        await this.dbx.update(vehicleItems).set(updateData).where(eq(vehicleItems.id, entityId));
        break;
      case 'asset_item':
        await this.dbx.update(assetItems).set(updateData).where(eq(assetItems.id, entityId));
        break;
      case 'task_action_item':
        await this.dbx.update(taskActionItems).set(updateData).where(eq(taskActionItems.id, entityId));
        break;
      case 'tax_legal_item':
        await this.dbx.update(taxLegalItems).set(updateData).where(eq(taxLegalItems.id, entityId));
        break;
      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async getOccurrenceCurrentStatus(
    userId: string,
    occurrenceKey: string
  ): Promise<{
    occurrenceKey: string;
    status: "completed" | "skipped" | null;
    note: string | null;
    updatedAt: string | null;
  }> {
    const result = await this.dbx.execute(sql`
      select distinct on (occurrence_key)
        status,
        note,
        created_at
      from task_occurrence_events
      where occurrence_key = ${occurrenceKey}
        and user_id = ${userId}
      order by occurrence_key, created_at desc, id desc
      limit 1
    `);
    const row = (result as any)?.rows?.[0];
    return {
      occurrenceKey,
      status: row?.status ?? null,
      note: row?.note ?? null,
      updatedAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    };
  }

  async getOccurrenceStatusesForEntity(
    userId: string,
    entityType: string,
    entityId: string,
    from?: string | null,
    to?: string | null
  ): Promise<
    {
      occurrence_key: string;
      status: string;
      note: string | null;
      updated_at: Date | string | null;
    }[]
  > {
    const keyPattern = entityType + ":" + entityId + "::%";
    const conditions = [sql`user_id = ${userId}`, sql`occurrence_key like ${keyPattern}`];
    if (from) {
      conditions.push(sql`occurrence_task_utc >= ${from}`);
    }
    if (to) {
      // end-inclusive to match items at midnight of the end date
      conditions.push(sql`occurrence_task_utc <= ${to}::date + interval '1 day' - interval '1 second'`);
    }

    const whereClause = conditions.reduce(
      (acc, clause, idx) => (idx === 0 ? clause : sql`${acc} and ${clause}`),
      sql`` as any
    );

    console.log(`🔍 Query occurrence statuses: pattern="${keyPattern}", userId=${userId}, from=${from || 'N/A'}, to=${to || 'N/A'}`);

    const result = await this.dbx.execute(sql`
      select distinct on (occurrence_key)
        occurrence_key,
        status,
        note,
        created_at as updated_at
      from task_occurrence_events
      where ${whereClause}
      order by occurrence_key, created_at desc, id desc
    `);
    const rows = ((result as any)?.rows ?? []) as any[];
    console.log(`🔍 Found ${rows.length} occurrence status(es) for ${entityType}:${entityId}`);
    return rows;
  }

  async insertOccurrenceCompleteEvent(params: {
    userId: string;
    reminderScheduleId: string;
    occurrenceKey: string;
    occurrenceTaskUtc: string;
    note?: string | null;
  }): Promise<{ inserted: boolean }> {
    if (!params.reminderScheduleId) {
      throw new Error("insertOccurrenceCompleteEvent: reminderScheduleId is required");
    }
    const result = await this.dbx.execute(sql`
      insert into task_occurrence_events (
        reminder_schedule_id,
        user_id,
        occurrence_key,
        occurrence_task_utc,
        action,
        status,
        note
      ) values (
        ${params.reminderScheduleId},
        ${params.userId},
        ${params.occurrenceKey},
        ${params.occurrenceTaskUtc},
        'complete',
        'completed',
        ${params.note ?? null}
      )
      on conflict (user_id, occurrence_key, action)
      do nothing
      returning true as inserted
    `);
    const rows = (result as any)?.rows ?? [];
    const inserted = rows.length > 0 ? Boolean(rows[0].inserted) : false;
    
    // ⭐ Also update occurrence_reminders
    await this.dbx
      .update(occurrenceReminders)
      .set({
        taskStatus: 'completed',
        completedAt: new Date(),
        taskNote: params.note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(occurrenceReminders.userId, params.userId),
          eq(occurrenceReminders.occurrenceKey, params.occurrenceKey)
        )
      );
    
    return { inserted };
  }

  // Task Actions methods


  // Task Actions methods
  async getTaskAction(id: string): Promise<SelectTaskAction | undefined> {
    const rows = await this.dbx.execute(
      sql`select
             id,
             title,
             description,
             category,
             priority,
             coalesce(assignees, '[]'::jsonb) as "assignees",
             coalesce(task_points, '[]'::jsonb) as "taskPoints",
             status,
             created_by as "createdBy",
             created_at as "createdAt",
             updated_at as "updatedAt",
             false as "isRecurring",
             null::jsonb as "recurrenceData",
             '[]'::jsonb as "customReminderDates",
             '[]'::jsonb as "reminderTimes",
             '[]'::jsonb as "notificationChannels",
             '[]'::jsonb as "emailRecipients",
             '[]'::jsonb as "whatsappRecipients",
             '[]'::jsonb as "smsRecipients"
           from task_actions
           where id = ${id}
           limit 1;`
    );

    const result =
      (rows as any)?.rows?.[0] ??
      (Array.isArray(rows) ? rows[0] : undefined);

    return result as SelectTaskAction | undefined;
  }

  async getAllTaskActions(): Promise<SelectTaskAction[]> {
    const rows = await this.dbx.execute(
      sql`select
             id,
             title,
             description,
             category,
             priority,
             coalesce(assignees, '[]'::jsonb) as "assignees",
             coalesce(task_points, '[]'::jsonb) as "taskPoints",
             status,
             created_by as "createdBy",
             created_at as "createdAt",
             updated_at as "updatedAt",
             false as "isRecurring",
             null::jsonb as "recurrenceData",
             '[]'::jsonb as "customReminderDates",
             '[]'::jsonb as "reminderTimes",
             '[]'::jsonb as "notificationChannels",
             '[]'::jsonb as "emailRecipients",
             '[]'::jsonb as "whatsappRecipients",
             '[]'::jsonb as "smsRecipients"
           from task_actions
           order by created_at desc;`
    );

    return ((rows as any)?.rows ?? rows) as SelectTaskAction[];
  }

  async getTaskActionsByUser(userId: string): Promise<SelectTaskAction[]> {
    const rows = await this.dbx.execute(
      sql`select
             id,
             title,
             description,
             category,
             priority,
             coalesce(assignees, '[]'::jsonb) as "assignees",
             coalesce(task_points, '[]'::jsonb) as "taskPoints",
             status,
             created_by as "createdBy",
             created_at as "createdAt",
             updated_at as "updatedAt",
             false as "isRecurring",
             null::jsonb as "recurrenceData",
             '[]'::jsonb as "customReminderDates",
             '[]'::jsonb as "reminderTimes",
             '[]'::jsonb as "notificationChannels",
             '[]'::jsonb as "emailRecipients",
             '[]'::jsonb as "whatsappRecipients",
             '[]'::jsonb as "smsRecipients"
           from task_actions
           where created_by = ${userId}
           order by created_at desc;`
    );

    return ((rows as any)?.rows ?? rows) as SelectTaskAction[];
  }

  async createTaskAction(action: InsertTaskAction): Promise<SelectTaskAction> {
    // Some environments still lack the task_points column. Use a minimal raw
    // insert that avoids that column but preserves core fields.
    // ⚠️ REMOVED: dueDate/dueTime - Task Actions parent doesn't have due dates
    const {
      title,
      description,
      category,
      priority,
      assignees,
      taskPoints,
      status,
      createdBy,
    } = action as any;

    const rows = await this.dbx.execute(
      sql`insert into task_actions (
            title,
            description,
            category,
            priority,
            assignees,
            task_points,
            status,
            created_by
          ) values (
            ${title},
            ${description ?? ""},
            ${category},
            ${priority ?? "medium"},
            ${JSON.stringify(assignees ?? [])}::jsonb,
            ${JSON.stringify(taskPoints ?? [])}::jsonb,
            ${status ?? "pending"},
            ${createdBy}
          )
          returning *;`
    );

    const result =
      (rows as any)?.rows?.[0] ??
      (Array.isArray(rows) ? rows[0] : undefined);

    return result as SelectTaskAction;
  }

  async updateTaskAction(id: string, updates: Partial<InsertTaskAction>): Promise<SelectTaskAction> {
    // IMPORTANT:
    // Task Actions (parent) are NOT recurring. Recurrence/reminders belong to child task tables only.
    // Some environments don't have columns like is_recurring / recurrence_data on task_actions.
    // So we must use an explicit allow-list and avoid Drizzle returning() on taskActions (which can
    // reference non-existent columns and crash).

    const u: any = updates ?? {};

    // Explicit allow-list (parent metadata only)
    const allowed: Record<string, unknown> = {};
    if ("title" in u) allowed.title = u.title;
    if ("description" in u) allowed.description = u.description;
    if ("category" in u) allowed.category = u.category;
    if ("priority" in u) allowed.priority = u.priority;
    if ("status" in u) allowed.status = u.status;

    // ⚠️ REMOVED: dueDate/dueTime - Task Actions parent doesn't have due dates

    if ("assignees" in u) {
      allowed.assignees = JSON.stringify(u.assignees ?? []);
    }
    if ("taskPoints" in u || "task_points" in u) {
      allowed.task_points = JSON.stringify(u.taskPoints ?? u.task_points ?? []);
    }
    if ("completionNotes" in u || "completion_notes" in u) {
      allowed.completion_notes = u.completionNotes ?? u.completion_notes;
    }

    // Build SET clauses dynamically (partial update semantics)
    const setClauses: Array<{ col: string; frag: any }> = [];
    if ("title" in allowed) setClauses.push({ col: "title", frag: sql`title = ${allowed.title}` });
    if ("description" in allowed)
      setClauses.push({ col: "description", frag: sql`description = ${allowed.description}` });
    if ("category" in allowed)
      setClauses.push({ col: "category", frag: sql`category = ${allowed.category}` });
    if ("priority" in allowed)
      setClauses.push({ col: "priority", frag: sql`priority = ${allowed.priority}` });
    if ("status" in allowed) setClauses.push({ col: "status", frag: sql`status = ${allowed.status}` });
    // ⚠️ REMOVED: due_date/due_time SET clauses
    if ("assignees" in allowed)
      setClauses.push({
        col: "assignees",
        frag: sql`assignees = ${allowed.assignees}::jsonb`,
      });
    if ("task_points" in allowed)
      setClauses.push({
        col: "task_points",
        frag: sql`task_points = ${allowed.task_points}::jsonb`,
      });
    if ("completion_notes" in allowed)
      setClauses.push({
        col: "completion_notes",
        frag: sql`completion_notes = ${allowed.completion_notes}`,
      });

    // Always bump updated_at
    setClauses.push({ col: "updated_at", frag: sql`updated_at = now()` });

    const runUpdate = async (clauses: Array<{ col: string; frag: any }>) => {
      const rows = await this.dbx.execute(sql`
        update task_actions
        set ${sql.join(
          clauses.map((c) => c.frag),
          sql`, `
        )}
        where id = ${id}
        returning
          id,
          title,
          description,
          category,
          priority,
          coalesce(assignees, '[]'::jsonb) as "assignees",
          coalesce(task_points, '[]'::jsonb) as "taskPoints",
          status,
          created_by as "createdBy",
          created_at as "createdAt",
          updated_at as "updatedAt",
          false as "isRecurring",
          null::jsonb as "recurrenceData",
          '[]'::jsonb as "customReminderDates",
          '[]'::jsonb as "reminderTimes",
          '[]'::jsonb as "notificationChannels",
          '[]'::jsonb as "emailRecipients",
          '[]'::jsonb as "whatsappRecipients",
          '[]'::jsonb as "smsRecipients"
      `);

      return (
        (rows as any)?.rows?.[0] ??
        (Array.isArray(rows) ? (rows as any)[0] : undefined)
      ) as SelectTaskAction;
    };

    try {
      return await runUpdate(setClauses);
    } catch (e: any) {
      // Backward-compatible fallback: some DBs still lack these columns
      const msg = String(e?.message || e);
      const maybeMissingCols = ["task_points", "due_time", "completion_notes"];
      let clauses = [...setClauses];
      for (const col of maybeMissingCols) {
        if (msg.includes(`column "${col}" does not exist`) || msg.includes(`column ${col} does not exist`)) {
          clauses = clauses.filter((c) => c.col !== col);
        }
      }
      if (clauses.length === setClauses.length) {
        throw e;
      }
      return await runUpdate(clauses);
    }
  }

  async deleteTaskAction(id: string): Promise<void> {
    // Delete associated reminders first
    await this.deleteOccurrenceRemindersByEntity('task_action', id);
    // Then delete the task action
    await this.dbx
      .delete(taskActions)
      .where(eq(taskActions.id, id));
  }

  // Calendar Events methods
  async getCalendarEvent(id: string): Promise<SelectCalendarEvent | undefined> {
    const [result] = await this.dbx
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, id));
    return result;
  }

  async getCalendarEventsByUser(userId: string): Promise<SelectCalendarEvent[]> {
    return await this.dbx
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.createdBy, userId))
      .orderBy(desc(calendarEvents.eventDate));
  }

  async createCalendarEvent(event: InsertCalendarEvent): Promise<SelectCalendarEvent> {
    const [result] = await this.dbx
      .insert(calendarEvents)
      .values(event)
      .returning();
    const resultCategory = (result as any)?.category ?? null;
    
    // Automatically create reminder if reminderDays is set
    if (result.reminderDays && result.reminderDays > 0) {
      // Parse JSONB fields properly (handle both native arrays and JSON strings)
      const parseJsonbArray = (field: any): string[] => {
        if (Array.isArray(field)) {
          return field as string[];
        }
        if (typeof field === 'string') {
          try {
            const parsed = JSON.parse(field);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      };

      const notificationChannels = parseJsonbArray(result.notificationChannels);
      const emailRecipients = parseJsonbArray(result.emailRecipients);
      const whatsappRecipients = parseJsonbArray(result.whatsappRecipients);

      // Fallback if no channels specified
      if (notificationChannels.length === 0) {
        notificationChannels.push('email');
      }

      // ✅ Create occurrence reminder using new system (replaces deprecated createOneTimeReminder)
      await this.materializeOccurrenceRemindersForEntity({
        userId: result.createdBy,
        entityType: 'calendar_event',
        entityId: result.id,
        taskTitle: result.title,
        isRecurring: false, // Calendar events are one-time
        dueDateYmd: result.eventDate,
        nextDueDateYmd: null,
        recurrenceData: null,
        reminderOffsetValue: result.reminderDays || DEFAULT_REMINDER_OFFSET_VALUE,
        reminderOffsetUnit: 'days',
        notificationChannels,
        emailRecipients,
        whatsappRecipients,
        smsRecipients: [],
        reminderTimes: ['09:00']
      });
    }
    
    return result;
  }

  async updateCalendarEvent(id: string, updates: Partial<InsertCalendarEvent>): Promise<SelectCalendarEvent> {
    const [result] = await this.dbx
      .update(calendarEvents)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(calendarEvents.id, id))
      .returning();
    return result;
  }

  async deleteCalendarEvent(id: string): Promise<void> {
    // Delete associated reminders first (both old and new systems)
    await this.deleteOccurrenceRemindersByEntity('calendar_event', id);
    await this.deleteOccurrenceRemindersByEntity('calendar_event', id);
    // Then delete the calendar event
    await this.dbx
      .delete(calendarEvents)
      .where(eq(calendarEvents.id, id));
  }

  // Task Completion - marks task as complete
  async completeTask(
    entityType: 'tax_item' | 'vehicle_item' | 'asset_item' | 'task_action_item' | 'task_action' | 'calendar_event' | 'tax_legal_item',
    entityId: string,
    completionNotes: string,
    userId: string
  ): Promise<void> {
    // Determine which table to update
    let table;
    let entityRecord: any = null;
    
    switch (entityType) {
      case 'vehicle_item':
        table = vehicleItems;
        [entityRecord] = await this.dbx.select().from(vehicleItems).where(eq(vehicleItems.id, entityId));
        break;
      case 'asset_item':
        table = assetItems;
        [entityRecord] = await this.dbx.select().from(assetItems).where(eq(assetItems.id, entityId));
        break;
      case 'task_action_item':
        table = taskActionItems;
        [entityRecord] = await this.dbx.select().from(taskActionItems).where(eq(taskActionItems.id, entityId));
        break;
      case 'task_action':
        table = taskActions;
        [entityRecord] = await this.dbx.select().from(taskActions).where(eq(taskActions.id, entityId));
        break;
      case 'calendar_event':
        table = calendarEvents;
        [entityRecord] = await this.dbx.select().from(calendarEvents).where(eq(calendarEvents.id, entityId));
        break;
      case 'tax_legal_item':
        table = taxLegalItems;
        [entityRecord] = await this.dbx.select().from(taxLegalItems).where(eq(taxLegalItems.id, entityId));
        break;
    }

    if (!table || !entityRecord) {
      console.warn(`Entity not found for completion: ${entityType}/${entityId}`);
      return;
    }

    const isRecurringEntity =
      entityType === 'vehicle_item' ||
      entityType === 'asset_item' ||
      entityType === 'task_action_item' ||
      entityType === 'tax_legal_item';

    if (isRecurringEntity && entityRecord?.isRecurring && entityRecord?.recurrenceData) {
      const effective = entityRecord.nextDueDate || entityRecord.dueDate;

      const nextDue = computeNextDueDateAfterCompletion({
        dueDate: entityRecord.dueDate,
        nextDueDate: entityRecord.nextDueDate,
        recurrenceData: entityRecord.recurrenceData,
        completedOn: effective,
      });

      if (nextDue) {
        await this.dbx
          .update(table)
          .set({
            status: 'pending',
            nextDueDate: nextDue,
            completedAt: null,
            completionNotes: completionNotes,
            updatedAt: sql`now()`,
          } as any)
          .where(eq(table.id, entityId));
      } else {
        await this.dbx
          .update(table)
          .set({
            status: 'completed',
            nextDueDate: null,
            completedAt: sql`now()`,
            completionNotes: completionNotes,
            updatedAt: sql`now()`,
          } as any)
          .where(eq(table.id, entityId));
      }
    } else {
      // Non-recurring or unsupported types: mark completed
      await this.dbx
        .update(table)
        .set({
          status: 'completed',
          completedAt: sql`now()`,
          completionNotes: completionNotes,
          updatedAt: sql`now()`,
        } as any)
        .where(eq(table.id, entityId));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ⭐ LAZY GENERATION MODEL - NEW REMINDER SYSTEM
  // ═══════════════════════════════════════════════════════════════

  /**
   * TEST-ONLY: execute raw sql template (drizzle sql``) via underlying db.
   * Do not use in production paths.
   */
  async __testExecute<T = any>(query: any): Promise<T> {
    return this.dbx.execute(query) as any;
  }

  private schedulerLockTableReady = false;

  /**
   * Ensure the lease table exists. Idempotent and cheap.
   *
   * We use a row-based lease instead of pg_advisory_lock because the app may talk
   * through a transaction pooler (pgBouncer). Session-level advisory locks
   * are acquired/released on whatever pooled backend handles
   * each query, so the unlock frequently lands on a different backend than the
   * lock and the lock leaks until the backend is recycled. A lease row has no
   * session state, so it is safe across pooled connections.
   */
  private async ensureSchedulerLockTable(): Promise<void> {
    if (!this.pool || this.schedulerLockTableReady) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scheduler_locks (
        name text PRIMARY KEY,
        locked_until timestamptz NOT NULL DEFAULT now(),
        holder text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    this.schedulerLockTableReady = true;
  }

  /**
   * Acquire a self-expiring lease for the scheduler (prevents overlapping cron runs).
   *
   * Returns a holder token if the lease was acquired, or null if another runner
   * currently holds an unexpired lease. The lease auto-expires after ttlSeconds
   * so a crashed run never blocks future runs permanently.
   *
   * Pass the returned token to releaseSchedulerLease so only the owner can release.
   */
  async acquireSchedulerLease(name: string, ttlSeconds: number): Promise<string | null> {
    if (!this.pool) return null;
    try {
      await this.ensureSchedulerLockTable();
      const token = `${crypto.randomUUID()}`;
      const result = await this.pool.query(
        `
        INSERT INTO scheduler_locks AS sl (name, locked_until, holder, updated_at)
        VALUES ($1, now() + make_interval(secs => $2), $3, now())
        ON CONFLICT (name) DO UPDATE
          SET locked_until = excluded.locked_until,
              holder = excluded.holder,
              updated_at = now()
          WHERE sl.locked_until < now()
        RETURNING holder
        `,
        [name, ttlSeconds, token]
      );
      return result.rowCount && result.rows[0]?.holder === token ? token : null;
    } catch (error) {
      console.error('Error acquiring scheduler lease:', error);
      return null;
    }
  }

  /**
   * Release the scheduler lease. Only releases if the token still matches,
   * so a runner can never release a lease that a later runner already took over.
   */
  async releaseSchedulerLease(name: string, token: string): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `UPDATE scheduler_locks SET locked_until = now(), updated_at = now()
         WHERE name = $1 AND holder = $2`,
        [name, token]
      );
    } catch (error) {
      console.error('Error releasing scheduler lease:', error);
    }
  }

  /**
   * TEST-ONLY: close underlying pool so node:test can exit cleanly.
   */
  async __testClose(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Graceful shutdown for script/tests to let Node exit.
   */
  async shutdown(): Promise<void> {
    try {
      const ss: any = this.sessionStore as any;
      if (ss && typeof ss.close === "function") {
        await ss.close();
      }
    } catch {
      // ignore session store close errors
    }
    if (this.pool && !(this.pool as any).ended && !(this.pool as any).ending) {
      try {
        await this.pool.end();
      } catch {
        // ignore pool end errors
      }
    }
  }
}

const shouldSkipStorageInit =
  process.env.SKIP_STORAGE_INIT === "true" ||
  (process.env.NODE_ENV === "test" && !process.env.DATABASE_URL);

export const storage = new DatabaseStorage({
  skipInit: shouldSkipStorageInit,
  connectionString: process.env.DATABASE_URL,
});

// Export sql for test helpers that need tagged template access.
export { sql };

export async function shutdownStorage(): Promise<void> {
  await storage.shutdown();
}
