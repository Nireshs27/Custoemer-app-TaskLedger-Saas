import { useState, useMemo, useRef, useEffect, useLayoutEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Repeat2, Clock, Mail, MessageCircle, Info, ChevronRight, Calendar as CalendarIcon, AlertTriangle, Target, LayoutGrid, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseDateWithOptionalTime, formatUtcToIstDisplay } from "@/lib/datetime";
import { buildRecurrenceSummary, getRecurringStartEnd } from "@/lib/reminder-summary";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type RecurrenceData as SharedRecurrenceData, getNextOccurrence } from "@shared/recurrence-calculator";
import {
  normalizeRecurrenceForUi,
  safeParseRecurrenceJson,
} from "@/lib/recurrence-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow, isSameDay } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { findNearestOccurrence, scrollToOccurrenceWithinContainer } from "@/lib/occurrence-scroll";

// Updated to match unified reminder_schedules schema
export interface Reminder {
  id: string;
  scheduleType: 'one_time' | 'finite' | 'infinite';
  reminderDate: string;
  reminderInterval?: string | null; // 'minutely', 'daily', 'weekly', etc.
  reminderDaysBefore: number;
  status: 'pending' | 'sent' | 'failed' | 'completed' | 'cancelled';
  isActive: boolean;
  lastSentAt?: string | null;
  recipientEmail: string[];  // ⭐ Changed to array (TEXT[])
  recipientPhone?: string[] | null;  // ⭐ Changed to array (TEXT[])
  taskTitle: string;
  taskCategory?: string | null;
  notificationChannels?: string[];
  reminderTimes?: string[];
  totalOccurrences?: number | null;
  occurrencesRemaining?: number | null;
  recurrenceData?: SharedRecurrenceData | null;
  reminderOffsetValue?: number | null;
  reminderOffsetUnit?: 'minutes' | 'hours' | 'days' | null;
}

interface ReminderDisplayProps {
  entityType: 'tax_item' | 'vehicle_item' | 'asset_item' | 'task_action' | 'task_action_item' | 'calendar_event' | 'tax_legal_item';
  entityId: string;
  className?: string;
  // Optional: Pass recurring task info to display recurrence pattern
  isRecurring?: boolean;
  recurrenceData?: SharedRecurrenceData | null;
  dueDate?: string | Date | null;
  // Optional: For recurring tasks, filter reminders for specific occurrence date
  occurrenceDate?: string;
  compactOccurrences?: boolean; // hide inline occurrences, show summary link only
  // ✅ NEW: Target date for auto-scroll (from calendar click or defaults to today)
  targetDate?: Date;
  // ✅ NEW: Source context (optional, for logging/debugging)
  source?: 'calendar' | 'task-card' | 'other';
  // ✅ NEW: UI variant for different contexts
  variant?: 'default' | 'embedded';
}

type AggregateStatus = "pending" | "sent" | "failed" | "partial" | "expired" | "sending";

export type RecipientDeliveryStatus = {
  recipientEmail: string;
  status: "sent" | "failed" | "pending" | "expired" | "sending";
  attemptedAt: string | null;
  errorType?: string | null;
  errorMessage?: string | null;
  messageId?: string | null; // for sent status
};

export type ReminderOccurrenceDelivery = {
  reminderId: string | null;
  entityId: string;
  entityType: ReminderDisplayProps["entityType"];
  scheduleType: Reminder["scheduleType"] | null;
  occurrenceNumber: number;
  reminderDate: string | null;
  taskDate?: string | null;
  calculatedReminderDate?: string | null;
  calculatedTaskDate?: string | null;
  recipientStatuses: RecipientDeliveryStatus[];
  aggregateStatus: AggregateStatus;
  aggregateStatusChangedAt: string | null;
};

type DeliverySummary = {
  hasIssues: boolean;
  pendingRetryCount: number;
  permanentFailureCount: number;
  lastErrorMessage: string | null;
  lastAttemptAt: string | null;
  sentCount: number;
  failedCount: number;
};

// ⭐ Server-grouped occurrence (one per occurrence_key)
export type DbGroupedOccurrence = {
  occurrenceKey: string;
  occurrenceTaskUtc: string;
  dueDateLocalYmd: string;
  taskTitle: string;
  taskCategory: string | null;
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
};

export type DbOccurrencesResponse = {
  items: DbGroupedOccurrence[];
  nextCursor: string | null;
  prevCursor: string | null;
};

const AGGREGATE_STATUS_META: Record<
  AggregateStatus,
  { label: string; cardClass: string; textClass: string; iconColor: string }
> = {
  sent: {
    label: "Sent",
    cardClass: "bg-green-50/70 border-green-200",
    textClass: "text-green-700",
    iconColor: "#10B981",
  },
  failed: {
    label: "Failed",
    cardClass: "bg-red-50/70 border-red-200",
    textClass: "text-red-600",
    iconColor: "#EF4444",
  },
  expired: {
    label: "Expired",
    cardClass: "bg-gray-50/70 border-gray-300",
    textClass: "text-gray-600",
    iconColor: "#6B7280",
  },
  sending: {
    label: "Sending",
    cardClass: "bg-blue-50/70 border-blue-200",
    textClass: "text-blue-600",
    iconColor: "#3B82F6",
  },
  partial: {
    label: "Partially Sent",
    cardClass: "bg-amber-50/70 border-amber-200",
    textClass: "text-amber-600",
    iconColor: "#F59E0B",
  },
  pending: {
    label: "Scheduled",
    cardClass: "bg-muted/50 border-muted",
    textClass: "text-muted-foreground",
    iconColor: "#9CA3AF",
  },
};

const RECIPIENT_STATUS_META: Record<
  RecipientDeliveryStatus["status"],
  { label: string; textClass: string; dotClass: string }
> = {
  sent: {
    label: "Sent",
    textClass: "text-green-600",
    dotClass: "bg-green-500",
  },
  failed: {
    label: "Failed",
    textClass: "text-red-600",
    dotClass: "bg-red-500",
  },
  expired: {
    label: "Expired",
    textClass: "text-gray-600",
    dotClass: "bg-gray-500",
  },
  sending: {
    label: "Sending",
    textClass: "text-blue-600",
    dotClass: "bg-blue-500",
  },
  pending: {
    label: "Pending",
    textClass: "text-muted-foreground",
    dotClass: "bg-slate-400",
  },
};

const buildOccurrenceKey = (reminderId: string, occurrenceNumber: number) =>
  `${reminderId}::${occurrenceNumber}`;

const DEFAULT_FAILURE_MESSAGE =
  "Failed to send email notification. We will retry automatically.";

const DEFAULT_TASK_TIME = "09:00";

const getTaskTime = (reminder: Reminder): string => {
  const taskTime = reminder.reminderTimes?.[0];
  return typeof taskTime === "string" && taskTime.trim().length > 0
    ? taskTime
    : DEFAULT_TASK_TIME;
};

const getReminderSendTime = (reminder: Reminder): string => {
  const reminderTime = reminder.reminderTimes?.[1];
  if (typeof reminderTime === "string" && reminderTime.trim().length > 0) {
    return reminderTime;
  }
  return getTaskTime(reminder);
};

const getReminderOffsetValue = (reminder: Reminder): number => {
  if (
    typeof reminder.reminderOffsetValue === "number" &&
    !Number.isNaN(reminder.reminderOffsetValue)
  ) {
    return reminder.reminderOffsetValue;
  }
  if (
    typeof reminder.reminderDaysBefore === "number" &&
    !Number.isNaN(reminder.reminderDaysBefore)
  ) {
    return reminder.reminderDaysBefore;
  }
  return 0;
};

const getReminderOffsetUnit = (
  reminder: Reminder
): NonNullable<Reminder["reminderOffsetUnit"]> => {
  const unit = reminder.reminderOffsetUnit;
  if (unit === "minutes" || unit === "hours" || unit === "days") {
    return unit;
  }
  return "days";
};

const adjustDateByOffset = (
  date: Date,
  reminder: Reminder,
  direction: 1 | -1
): Date => {
  const value = getReminderOffsetValue(reminder);
  if (!value) {
    return new Date(date);
  }
  const unit = getReminderOffsetUnit(reminder);
  const multiplier =
    unit === "minutes"
      ? 60 * 1000
      : unit === "hours"
      ? 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  return new Date(date.getTime() + direction * value * multiplier);
};

const applyIstTimeToUtcDate = (base: Date, istTime: string): Date => {
  const result = new Date(base);
  const [hoursStr, minutesStr] = istTime.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return result;
  }

  // Convert IST (UTC+5:30) to UTC clock time
  let totalMinutes = hours * 60 + minutes - 330;
  let dayAdjustment = 0;
  while (totalMinutes < 0) {
    totalMinutes += 1440;
    dayAdjustment -= 1;
  }
  while (totalMinutes >= 1440) {
    totalMinutes -= 1440;
    dayAdjustment += 1;
  }

  const utcHours = Math.floor(totalMinutes / 60);
  const utcMinutes = totalMinutes % 60;

  result.setUTCDate(result.getUTCDate() + dayAdjustment);
  result.setUTCHours(utcHours, utcMinutes, 0, 0);
  return result;
};

const deriveTaskDateFromReminderDate = (
  reminder: Reminder,
  reminderDateOverride?: Date
): Date => {
  const reminderDateSource = reminderDateOverride
    ? new Date(reminderDateOverride)
    : new Date(reminder.reminderDate);
  if (Number.isNaN(reminderDateSource.getTime())) {
    return new Date();
  }
  const taskDate = adjustDateByOffset(reminderDateSource, reminder, +1);
  return applyIstTimeToUtcDate(taskDate, getTaskTime(reminder));
};

const deriveReminderDateFromTaskDate = (
  reminder: Reminder,
  taskDate: Date
): Date => {
  const reminderDate = adjustDateByOffset(taskDate, reminder, -1);
  return applyIstTimeToUtcDate(reminderDate, getReminderSendTime(reminder));
};

export function deriveAggregateStatusFromRecipients(
  recipients: RecipientDeliveryStatus[]
): AggregateStatus {
  if (recipients.length === 0) {
    return "pending";
  }
  const statuses = recipients.map((recipient) => recipient.status);
  
  // ⭐ Priority order (as per requirements):
  // 1. If ALL recipients are sent -> "sent"
  if (statuses.every((status) => status === "sent")) {
    return "sent";
  }
  
  // 2. Else if ANY recipient is failed -> "failed"
  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }
  
  // 3. Else if ANY recipient is expired -> "expired"
  if (statuses.some((status) => status === "expired")) {
    return "expired";
  }
  
  // 4. Else if ANY recipient is sending -> "sending"
  if (statuses.some((status) => status === "sending")) {
    return "sending";
  }
  
  // 5. Else if some sent and some pending -> "partial"
  if (statuses.some((status) => status === "sent") && statuses.some((status) => status === "pending")) {
    return "partial";
  }
  
  // 6. Default -> "pending" (all pending or unknown)
  return "pending";
}

const getLatestAttemptedAt = (
  recipients: RecipientDeliveryStatus[]
): string | null => {
  const timestamps = recipients
    .map((recipient) =>
      recipient.attemptedAt ? new Date(recipient.attemptedAt).getTime() : null
    )
    .filter(
      (value): value is number =>
        typeof value === "number" && !Number.isNaN(value)
    );
  if (timestamps.length === 0) {
    return null;
  }
  return new Date(Math.max(...timestamps)).toISOString();
};

export function buildRecipientStatuses(
  reminder: Reminder,
  delivery?: ReminderOccurrenceDelivery
): RecipientDeliveryStatus[] {
  const scheduleRecipients = Array.isArray(reminder.recipientEmail)
    ? reminder.recipientEmail
    : reminder.recipientEmail
    ? [reminder.recipientEmail]
    : [];

  const historyStatuses = delivery?.recipientStatuses ?? [];
  const historyMap = new Map(
    historyStatuses
      .filter((status) => !!status.recipientEmail)
      .map((status) => [status.recipientEmail!.toLowerCase(), status])
  );

  const merged: RecipientDeliveryStatus[] = [];

  scheduleRecipients.forEach((recipient) => {
    if (!recipient) {
      return;
    }
    const normalized = recipient.toLowerCase();
    const existing = historyMap.get(normalized);
    if (existing) {
      merged.push(existing);
    } else {
      merged.push({
        recipientEmail: recipient,
        status: "pending",
        attemptedAt: null,
        errorType: null,
        errorMessage: null,
      });
    }
  });

  historyStatuses.forEach((status) => {
    if (!status.recipientEmail) {
      return;
    }
    const normalized = status.recipientEmail.toLowerCase();
    const exists = scheduleRecipients.some(
      (recipient) => recipient?.toLowerCase() === normalized
    );
    if (!exists) {
      merged.push(status);
    }
  });

  return merged;
}

const deriveAggregateStatusForOccurrence = (
  delivery: ReminderOccurrenceDelivery | undefined,
  recipients: RecipientDeliveryStatus[]
): AggregateStatus => {
  if (delivery?.aggregateStatus) {
    return delivery.aggregateStatus;
  }
  return deriveAggregateStatusFromRecipients(recipients);
};

/**
 * Render a single reminder occurrence card
 * Shows: Task date, Reminder date, Email status, Occurrence number (for recurring)
 */
function ReminderOccurrenceCard({ 
  occurrence, 
  showOccurrenceNumber = false,
  isHighlighted = false,
}: { 
  occurrence: ReminderOccurrence;
  showOccurrenceNumber?: boolean;
  isHighlighted?: boolean;
}) {
  // ⭐ Use DB truth for completion status
  const completionStatus = occurrence.taskStatus === 'completed' || Boolean(occurrence.completedAt);
  const aggregateMeta =
    completionStatus
      ? {
          label: "Completed",
          cardClass: "bg-green-50 border-green-200",
          textClass: "text-green-700",
          iconColor: "#16A34A",
        }
      : AGGREGATE_STATUS_META[occurrence.aggregateStatus] ??
        AGGREGATE_STATUS_META.pending;
  const recipientStatuses =
    occurrence.recipientStatuses && occurrence.recipientStatuses.length > 0
      ? occurrence.recipientStatuses
      : [];
  const formattedTaskDate = formatUtcToIstDisplay(
    occurrence.calculatedTaskDateUtc
  );
  const formattedReminderDate = formatUtcToIstDisplay(
    occurrence.calculatedReminderDateUtc
  );
  
  return (
    <Card 
      className={cn(
        "m-4 p-6 rounded-md bg-white border-0",
        "shadow-occurrence hover:shadow-occurrence-hover",
        "transition-shadow duration-200",
        isHighlighted && "ring-2 ring-primary/40 bg-primary/5"
      )}
      data-occurrence-id={occurrence.id}
      data-highlighted={isHighlighted ? "true" : undefined}
      data-testid={`occurrence-card-${occurrence.id}`}
    >
      {/* Top row: occurrence number + status pill */}
      <div className="flex items-start justify-between gap-4 mb-3">
        {showOccurrenceNumber && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-600">
            Occurrence #{occurrence.occurrenceIndex + 1}
            {occurrence.totalOccurrences && ` of ${occurrence.totalOccurrences}`}
          </div>
        )}
        <Badge
          variant="outline"
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold uppercase border",
            completionStatus
              ? "border-green-600 text-green-600 bg-white"
              : occurrence.aggregateStatus === "sent"
              ? "border-green-600 text-green-600 bg-white"
              : occurrence.aggregateStatus === "failed"
              ? "border-red-600 text-red-600 bg-white"
              : occurrence.aggregateStatus === "expired"
              ? "border-gray-600 text-gray-600 bg-white"
              : occurrence.aggregateStatus === "sending"
              ? "border-blue-600 text-blue-600 bg-white"
              : occurrence.aggregateStatus === "partial"
              ? "border-amber-600 text-amber-600 bg-white"
              : "border-gray-400 text-gray-600 bg-white"
          )}
        >
          {completionStatus ? "COMPLETED" : aggregateMeta.label.toUpperCase()}
        </Badge>
      </div>

      {/* Detail rows */}
      <div className="space-y-2.5">
        {/* Task date row */}
        <div className="flex items-center gap-2.5">
          <CalendarIcon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Task:</span> {formattedTaskDate}
          </p>
        </div>

        {/* Reminder date row */}
        <div className="flex items-center gap-2.5">
          <Clock className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <p className="text-sm text-foreground">
            <span className="font-medium">Reminder:</span> {formattedReminderDate}
          </p>
        </div>

        {/* Sent/Pending row */}
        <div className="space-y-2">
          {recipientStatuses.length === 0 ? (
            <div className="flex items-center gap-2.5">
              <Mail className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">No recipients configured</span>
            </div>
          ) : (
            recipientStatuses.map((recipient) => {
              const meta = RECIPIENT_STATUS_META[recipient.status];
              const attemptedLabel = recipient.attemptedAt
                ? formatUtcToIstDisplay(recipient.attemptedAt)
                : null;
              const failureMessage =
                (recipient.errorMessage || DEFAULT_FAILURE_MESSAGE).trim();

              return (
                <div
                  key={`${recipient.recipientEmail}-${recipient.status}-${recipient.attemptedAt}`}
                  className="flex items-start gap-2.5"
                >
                  <Mail className="w-4 h-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 space-y-0.5">
                    <p className="text-sm text-foreground">
                      {recipient.status === "sent" ? (
                        <>
                          Sent to <span className="text-green-600 font-medium">{recipient.recipientEmail}</span>
                          {attemptedLabel && (
                            <span className="text-muted-foreground ml-1">
                              on {attemptedLabel}
                            </span>
                          )}
                          {recipient.messageId && (
                            <span className="text-muted-foreground text-xs ml-1">
                              (ID: {recipient.messageId.substring(0, 8)}...)
                            </span>
                          )}
                        </>
                      ) : recipient.status === "failed" ? (
                        <>
                          Failed for <span className="text-red-600 font-medium">{recipient.recipientEmail}</span>
                          {attemptedLabel && (
                            <span className="text-muted-foreground ml-1">
                              on {attemptedLabel}
                            </span>
                          )}
                        </>
                      ) : recipient.status === "expired" ? (
                        <>
                          Expired for <span className="text-gray-600 font-medium">{recipient.recipientEmail}</span>
                          {attemptedLabel && (
                            <span className="text-muted-foreground ml-1">
                              on {attemptedLabel}
                            </span>
                          )}
                        </>
                      ) : recipient.status === "sending" ? (
                        <>
                          Sending to <span className="text-blue-600 font-medium">{recipient.recipientEmail}</span>
                        </>
                      ) : (
                        <>
                          Pending for <span className="font-medium">{recipient.recipientEmail}</span>
                        </>
                      )}
                    </p>
                    {(recipient.status === "failed" || recipient.status === "expired") && failureMessage && (
                      <p className="text-xs text-muted-foreground">
                        {failureMessage}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Calculate task due date from reminder date
 * taskDueDate = reminderDate + reminderDaysBefore
 * Applies the task time from reminderTimes[0] for both one-time and recurring tasks
 */
function calculateTaskDueDateFromReminder(reminder: Reminder): Date {
  return deriveTaskDateFromReminderDate(reminder);
}

/**
 * Calculate next reminder date based on interval pattern
 */
/**
 * Expand a recurring reminder into multiple occurrence objects
 * ONE database row → MULTIPLE occurrence displays
 */
export interface ReminderOccurrence extends Omit<Reminder, "status"> {
  scheduleStatus: Reminder["status"];
  occurrenceIndex: number; // 0-based index
  calculatedReminderDateUtc: string;
  calculatedTaskDateUtc: string;
  reminderHistoryDateUtc?: string | null;
  reminderHistoryTaskDateUtc?: string | null;
  recipientStatuses: RecipientDeliveryStatus[];
  aggregateStatus: AggregateStatus;
  aggregateStatusChangedAt?: string | null;
  baseReminderId?: string; // Original reminder schedule ID for delivery mapping
  // ⭐ DB-driven fields
  taskStatus?: string;
  completedAt?: string | null;
  completionStatus?: string;
}

export function expandRecurringReminder(
  reminder: Reminder,
  occurrenceDeliveries?: Map<string, ReminderOccurrenceDelivery>,
  baseTaskDateOverride?: Date
): ReminderOccurrence[] {
  const parsedRecurrence = safeParseRecurrenceJson(reminder.recurrenceData);
  const resolveDelivery = (occurrenceNumber: number) => {
    if (!reminder.id || !occurrenceDeliveries) {
      return undefined;
    }
    return occurrenceDeliveries.get(
      buildOccurrenceKey(reminder.id, occurrenceNumber)
    );
  };

  const buildOccurrence = (
    occurrenceIndex: number,
    reminderDate: Date,
    taskDate: Date,
    occurrenceNumber: number
  ): ReminderOccurrence => {
    const delivery = resolveDelivery(occurrenceNumber);
    const recipientStatuses = buildRecipientStatuses(reminder, delivery);
    const aggregateStatus = deriveAggregateStatusForOccurrence(
      delivery,
      recipientStatuses
    );
    const aggregateStatusChangedAt =
      delivery?.aggregateStatusChangedAt ??
      getLatestAttemptedAt(recipientStatuses);

    const { status: scheduleStatus, ...reminderWithoutStatus } = reminder;

    // ⭐ Create unique occurrence ID for auto-scroll/highlight support
    const occurrenceId = `${reminder.id}::${occurrenceNumber}`;

    return {
      ...reminderWithoutStatus,
      id: occurrenceId, // Unique ID per occurrence
      baseReminderId: reminder.id, // Preserve original schedule ID for delivery mapping
      scheduleStatus,
      occurrenceIndex,
      calculatedReminderDateUtc: reminderDate.toISOString(),
      calculatedTaskDateUtc: taskDate.toISOString(),
      reminderHistoryDateUtc:
        delivery?.calculatedReminderDate ?? delivery?.reminderDate ?? null,
      reminderHistoryTaskDateUtc:
        delivery?.calculatedTaskDate ?? delivery?.taskDate ?? null,
      recipientStatuses,
      aggregateStatus,
      aggregateStatusChangedAt,
    };
  };

  if (reminder.scheduleType === "one_time") {
    const reminderDate = new Date(reminder.reminderDate);
    return [
      buildOccurrence(
        0,
        reminderDate,
        calculateTaskDueDateFromReminder(reminder),
        1
      ),
    ];
  }

  const occurrences: ReminderOccurrence[] = [];
  const totalOccurrences =
    reminder.totalOccurrences ?? parsedRecurrence?.endCount ?? 2100;
  const limitOccurrences =
    reminder.scheduleType === "infinite" ? 2100 : totalOccurrences;

  const resolvedBaseTaskDate = (() => {
    const recurrenceStart = parsedRecurrence?.startDate
      ? new Date(parsedRecurrence.startDate as any)
      : null;
    if (recurrenceStart && !Number.isNaN(recurrenceStart.getTime())) {
      return recurrenceStart;
    }
    if (baseTaskDateOverride && !Number.isNaN(baseTaskDateOverride.getTime())) {
      return new Date(baseTaskDateOverride);
    }
    return calculateTaskDueDateFromReminder(reminder);
  })();

  const taskTimeIst = getTaskTime(reminder);
  const reminderSendTimeIst = getReminderSendTime(reminder);

  // ⚠️ DEPRECATED: DB-driven rendering doesn't use frontend expansion anymore
  console.warn('expandRecurringReminder is deprecated - use DB-driven occurrences');
  return [];
}

/**
 * Group reminders by year
 */
function groupRemindersByYear(reminders: Reminder[]): Record<number, Reminder[]> {
  const grouped: Record<number, Reminder[]> = {};
  
  reminders.forEach(reminder => {
    const year = new Date(reminder.reminderDate).getFullYear();
    if (!grouped[year]) {
      grouped[year] = [];
    }
    grouped[year].push(reminder);
  });
  
  return grouped;
}

/**
 * Calculate the end date for a recurring task
 */
/**
 * Reusable component to display reminders for any entity type
 * Shows the next 2-3 upcoming reminders with a "show more" option
 * Also displays recurring task information if provided
 */
export function ReminderDisplay({ 
  entityType, 
  entityId, 
  className,
  isRecurring,
  recurrenceData,
  dueDate,
  occurrenceDate,
  compactOccurrences = false,
  targetDate,
  source,
  variant = 'default',
}: ReminderDisplayProps) {
  const [, navigate] = useLocation();
  const isEmbedded = variant === 'embedded';
  const [showAllModal, setShowAllModal] = useState(false);
  const [highlightedOccurrenceId, setHighlightedOccurrenceId] = useState<string | null>(null);
  const [manualTargetDate, setManualTargetDate] = useState<Date | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const baseDueDateFromProp = useMemo(
    () => parseDateWithOptionalTime(dueDate, undefined),
    [dueDate]
  );
  
  // Extract base entity ID from potentially synthetic IDs like "uuid::2025-11-21"
  // Recurring task occurrences use synthetic IDs with ::date suffix
  const baseEntityId = entityId.includes('::') ? entityId.split('::')[0] : entityId;
  
  // Check if this is a temporary ID (used during optimistic updates)
  const isTempId = baseEntityId.startsWith('temp-');
  
  // ⭐ Pagination state
  const [occurrencesMap, setOccurrencesMap] = useState<Map<string, DbGroupedOccurrence>>(new Map());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  // ⭐ Refs for robust pagination scroll targeting
  const pendingScrollRestoreRef = useRef<{ prevScrollHeight: number; prevScrollTop: number; prevBottom: number; clientHeight: number } | null>(null);
  const pendingAppendDirectionRef = useRef<"next" | "prev" | null>(null);
  const pendingAppendAnchorIdRef = useRef<string | null>(null);
  const disableModalAutoScrollRef = useRef(false);
  
  // ⭐ Initial fetch: Load ALL occurrences (no limit, backend uses fetchAll mode)
  const { data: initialData, isLoading, error: occurrencesError } = useQuery<DbOccurrencesResponse>({
    queryKey: [`/api/task-occurrences/entity/${entityType}/${baseEntityId}`],
    queryFn: async () => {
      return apiRequest<DbOccurrencesResponse>(
        'GET',
        `/api/task-occurrences/entity/${entityType}/${baseEntityId}`
      );
    },
    enabled: !!baseEntityId && !!entityType && !isTempId,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  // Log query status for debugging (only log errors)
  if (occurrencesError) {
    console.error(`❌ [ReminderDisplay] Query error for ${entityType}:${baseEntityId}:`, occurrencesError);
  }

  // Update occurrences map when initial data loads
  useEffect(() => {
    if (initialData?.items) {
      const newMap = new Map<string, DbGroupedOccurrence>();
      initialData.items.forEach(item => {
        newMap.set(item.occurrenceKey, item);
      });
      setOccurrencesMap(newMap);
      setNextCursor(initialData.nextCursor);
      setPrevCursor(initialData.prevCursor);
    }
  }, [initialData]);

  // ⭐ Load more function
  const loadMore = async (direction: 'prev' | 'next') => {
    const cursor = direction === 'prev' ? prevCursor : nextCursor;
    if (!cursor || isLoadingMore) return;

    // Disable modal auto-scroll once user starts paginating
    if (direction === 'next') {
      disableModalAutoScrollRef.current = true;
      console.debug('[LoadMore] Disabled modal auto-scroll (user is paginating)');
    }

    // Capture scroll position before API call
    const el = scrollContainerRef.current;
    if (el && direction === 'next') {
      const prevScrollHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;
      const clientHeight = el.clientHeight;
      const prevBottom = prevScrollHeight - (prevScrollTop + clientHeight);
      
      pendingScrollRestoreRef.current = {
        prevScrollHeight,
        prevScrollTop,
        prevBottom,
        clientHeight,
      };

      // Capture anchor: last occurrence in current UI ordering
      const lastOccurrence = allOccurrencesWithCompletion[allOccurrencesWithCompletion.length - 1];
      if (lastOccurrence) {
        pendingAppendAnchorIdRef.current = lastOccurrence.id;
      }
    }

    setIsLoadingMore(true);
    try {
      const params = new URLSearchParams({
        cursor,
        direction,
        limit: '10',
      });
      const response = await apiRequest<DbOccurrencesResponse>(
        'GET',
        `/api/task-occurrences/entity/${entityType}/${baseEntityId}?${params.toString()}`
      );

      // Set direction flag for pagination scroll
      if (direction === 'next') {
        pendingAppendDirectionRef.current = 'next';
      }

      // Merge results without duplicates
      setOccurrencesMap(prev => {
        const newMap = new Map(prev);
        response.items.forEach(item => {
          newMap.set(item.occurrenceKey, item);
        });
        return newMap;
      });

      // Update cursors
      if (direction === 'prev') {
        setPrevCursor(response.prevCursor);
      } else {
        setNextCursor(response.nextCursor);
      }
    } catch (error) {
      console.error(`❌ Failed to load ${direction} occurrences:`, error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const { data: deliverySummary } = useQuery<DeliverySummary>({
    queryKey: [
      `/api/reminders/delivery-status`,
      entityType,
      baseEntityId,
    ],
    enabled: !!baseEntityId && !!entityType && !isTempId,
    queryFn: async () => {
      const params = new URLSearchParams({
        entityType,
        entityId: baseEntityId,
      });
      return apiRequest<DeliverySummary>(
        "GET",
        `/api/reminders/delivery-status?${params.toString()}`
      );
    },
    staleTime: 30_000,
    retry: false,
  });

  const deliveryIssueMeta = useMemo(() => {
    if (!deliverySummary || !deliverySummary.hasIssues) {
      return null;
    }
    const severity =
      deliverySummary.permanentFailureCount > 0 ? "permanent" : "pending";
    const message =
      severity === "permanent"
        ? `Email delivery failed (${deliverySummary.permanentFailureCount})`
        : `Email delivery issue – retrying (${deliverySummary.pendingRetryCount})`;
    const detail = deliverySummary.lastErrorMessage;
    const lastAttemptLabel = deliverySummary.lastAttemptAt
      ? formatDistanceToNow(new Date(deliverySummary.lastAttemptAt), {
          addSuffix: true,
        })
      : null;
    return { severity, message, detail, lastAttemptLabel };
  }, [deliverySummary]);

  // ⭐ Single source of truth: is this task recurring?
  const isRecurringFromProps = Boolean(isRecurring) || Boolean(recurrenceData);

  // ⭐ DB-DRIVEN OCCURRENCES: Build from server-grouped occurrences
  const allOccurrences = useMemo(() => {
    if (occurrencesMap.size === 0) {
      return [];
    }

    console.log(`📋 [ReminderDisplay] Building ${occurrencesMap.size} occurrence(s) from server-grouped data`);

    // Build UI occurrences from server-grouped data
    const occurrences: ReminderOccurrence[] = Array.from(occurrencesMap.values()).map((dbOcc) => {
      // Build recipient statuses from recipients array
      const recipientStatuses: RecipientDeliveryStatus[] = dbOcc.recipients.map((r) => {
        // ⭐ Map ALL possible status values from DB (source of truth)
        let status: RecipientDeliveryStatus["status"] = 'pending';
        if (r.reminderStatus === 'sent') status = 'sent';
        else if (r.reminderStatus === 'failed') status = 'failed';
        else if (r.reminderStatus === 'expired') status = 'expired';
        else if (r.reminderStatus === 'sending') status = 'sending';
        // else defaults to 'pending'
        
        return {
          recipientEmail: r.recipient || '',
          status,
          attemptedAt: r.lastAttemptAt,
          errorMessage: r.lastError || undefined,
          errorType: undefined,
          messageId: r.messageId || undefined,
        };
      });

      // Derive aggregate status from recipients
      const aggregateStatus = deriveAggregateStatusFromRecipients(recipientStatuses);

      // Use earliest reminder date from server
      const calculatedReminderDateUtc = dbOcc.earliestReminderAtUtc || dbOcc.occurrenceTaskUtc;

      // ⭐ FIX #3: Compute latestAttemptAt as max of all recipient lastAttemptAt
      let latestAttemptAt: string | null = null;
      let maxMillis = -1;
      for (const r of dbOcc.recipients) {
        if (r.lastAttemptAt) {
          const ms = new Date(r.lastAttemptAt).getTime();
          if (!isNaN(ms) && ms > maxMillis) {
            maxMillis = ms;
            latestAttemptAt = r.lastAttemptAt;
          }
        }
      }

      // Build UI occurrence
      const occurrence: ReminderOccurrence = {
        id: dbOcc.occurrenceKey, // ⭐ Critical for scroll/highlight
        baseReminderId: dbOcc.occurrenceKey, // Use occurrence key as base ID
        scheduleStatus: dbOcc.taskStatus as any,
        occurrenceIndex: 0, // Will be recomputed after sorting
        calculatedTaskDateUtc: dbOcc.occurrenceTaskUtc,
        calculatedReminderDateUtc,
        reminderHistoryDateUtc: calculatedReminderDateUtc,
        reminderHistoryTaskDateUtc: dbOcc.occurrenceTaskUtc,
        recipientStatuses,
        aggregateStatus,
        aggregateStatusChangedAt: latestAttemptAt,
        // Fields from Reminder interface (not all applicable for DB-driven)
        reminderDate: calculatedReminderDateUtc,
        reminderDaysBefore: 0,
        isActive: true,
        recipientEmail: dbOcc.recipients.map(r => r.recipient || '').filter(Boolean),
        taskTitle: dbOcc.taskTitle,
        taskCategory: dbOcc.taskCategory,
        scheduleType: 'one_time', // Not used for UI decisions anymore
        // ⭐ Completion status from DB
        taskStatus: dbOcc.taskStatus,
        completedAt: dbOcc.completedAt,
        completionStatus: dbOcc.taskStatus === 'completed' || Boolean(dbOcc.completedAt) ? 'completed' : undefined,
      };

      return occurrence;
    });

    // Sort by task date (ascending - soonest first)
    occurrences.sort((a, b) => 
      new Date(a.calculatedTaskDateUtc).getTime() -
      new Date(b.calculatedTaskDateUtc).getTime()
    );

    // ⭐ Recompute occurrenceIndex after sorting
    occurrences.forEach((occ, index) => {
      occ.occurrenceIndex = index;
    });

    return occurrences;
  }, [occurrencesMap]);

  const hasReminders = allOccurrences.length > 0;
  
  // ⭐ Effective classification based on props + DB occurrences
  const effectiveIsOneTime = !isRecurringFromProps && allOccurrences.length === 1;
  const effectiveIsRecurring = isRecurringFromProps || allOccurrences.length > 1;
  
  // For one-time tasks in embedded mode: hide the card, just show link
  // For one-time tasks in default mode: show the card normally
  const shouldShowInlineOccurrences = !compactOccurrences || (effectiveIsOneTime && !isEmbedded);
  
  // ⭐ DB occurrences already have completion status - no need to fetch separately
  const allOccurrencesWithCompletion = allOccurrences;
  
  // Show first 3 occurrences in preview
  const previewLimit = 3;
  const previewOccurrences = allOccurrencesWithCompletion.slice(0, previewLimit);
  const remainingOccurrences = allOccurrencesWithCompletion.slice(previewLimit);
  const hasMoreOccurrences = remainingOccurrences.length > 0;
  
  // ✅ Show the "+ 1 more occurrence" link for one-time tasks in embedded variant
  const showOneTimeEmbeddedLink = isEmbedded && effectiveIsOneTime && allOccurrencesWithCompletion.length > 0;

  // ✅ Consistent "infinite vs finite" detection.
  // - Do NOT treat missing endType as infinite.
  // - Infer endType from endCount/endDate when endType is absent (legacy rows).
  const isInfiniteRecurrence = (raw: unknown): boolean => {
    const parsed = safeParseRecurrenceJson(raw);
    if (!parsed || typeof parsed !== "object") return false;
    // Require pattern to show the ♾️ line (prevents false positives)
    if (!(parsed as any).pattern) return false;

    const inferredEndType =
      (parsed as any).endType ??
      ((parsed as any).endCount ? "after" : (parsed as any).endDate ? "on" : "never");

    return inferredEndType === "never";
  };

  const recurrenceSummary = useMemo(() => {
    // Only show recurrence summary for actual recurring tasks.
    // (Prevents one-time tasks from showing the recurrence box.)
    if (!recurrenceData || !isRecurringFromProps) {
      return null;
    }

    const parsedRecurrence = safeParseRecurrenceJson(recurrenceData);
    if (!parsedRecurrence || typeof parsedRecurrence !== "object") {
      return null;
    }

    // ✅ Derive scheduleType from recurrence (robust for legacy rows missing endType)
    const inferredEndType =
      (parsedRecurrence as any).endType ??
      ((parsedRecurrence as any).endCount ? "after" : (parsedRecurrence as any).endDate ? "on" : "never");
    const isNever = inferredEndType === "never";
    const NEVER_CAP = 200;

    const seriesStart = parsedRecurrence.startDate ?? baseDueDateFromProp ?? new Date();

    const normalizedRecurrence = normalizeRecurrenceForUi(
      parsedRecurrence,
      new Date(seriesStart)
    );

    // ✅ Ensure summary sees the correct endType (avoid "Repeats indefinitely" when endCount/endDate exist)
    const recurrenceForSummary = {
      ...(normalizedRecurrence ?? (parsedRecurrence as any)),
      endType: (normalizedRecurrence as any)?.endType ?? inferredEndType,
    };

    // ✅ For "never" mode, compute end date from 200th occurrence
    let computedEndForNever: Date | null = null;
    if (isNever && normalizedRecurrence) {
      let cursor = new Date(seriesStart);
      for (let i = 1; i < NEVER_CAP; i++) {
        cursor = getNextOccurrence(cursor, normalizedRecurrence as any);
      }
      computedEndForNever = cursor;
    }

    const { start, end, totalCount } = getRecurringStartEnd(
      normalizedRecurrence as any,
      seriesStart,
      parsedRecurrence.endCount ?? null
    );

    // ⭐ FIX B: Derive reminder offset from DB occurrences
    let derivedOffsetValue = 0;
    let derivedOffsetUnit: "minutes" | "hours" | "days" = "days";
    
    // Find first valid occurrence with both task and reminder timestamps
    const firstValidOcc = allOccurrencesWithCompletion.find(
      occ => occ.calculatedTaskDateUtc && occ.calculatedReminderDateUtc
    );
    
    if (firstValidOcc) {
      const taskTime = new Date(firstValidOcc.calculatedTaskDateUtc).getTime();
      const reminderTime = new Date(firstValidOcc.calculatedReminderDateUtc).getTime();
      const deltaMs = taskTime - reminderTime;
      
      if (deltaMs > 0) {
        const deltaMinutes = deltaMs / (1000 * 60);
        const deltaHours = deltaMinutes / 60;
        const deltaDays = deltaHours / 24;
        
        // Choose unit: prefer days if whole number >= 1, else hours if >= 1, else minutes
        if (deltaDays >= 1 && Math.abs(deltaDays - Math.round(deltaDays)) < 0.01) {
          derivedOffsetValue = Math.round(deltaDays);
          derivedOffsetUnit = "days";
        } else if (deltaHours >= 1 && Math.abs(deltaHours - Math.round(deltaHours)) < 0.01) {
          derivedOffsetValue = Math.round(deltaHours);
          derivedOffsetUnit = "hours";
        } else {
          derivedOffsetValue = Math.round(deltaMinutes);
          derivedOffsetUnit = "minutes";
        }
      }
    }

    return buildRecurrenceSummary({
      startDate: start ?? baseDueDateFromProp ?? new Date(),
      endDate: isNever ? computedEndForNever : end,
      totalCount: isNever ? NEVER_CAP : (totalCount ?? null),
      recurrenceData: recurrenceForSummary,
      reminderOffsetValue: derivedOffsetValue,
      reminderOffsetUnit: derivedOffsetUnit,
    });
  }, [recurrenceData, isRecurringFromProps, allOccurrencesWithCompletion, baseDueDateFromProp]);
  
  // ⭐ Helper to format year range from occurrence list
  const formatYearRange = (occurrences: ReminderOccurrence[]) => {
    if (occurrences.length === 0) return '';
    
    const years = occurrences.map(o =>
      new Date(o.calculatedReminderDateUtc).getFullYear()
    );
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    
    return minYear === maxYear ? `${minYear}` : `${minYear}–${maxYear}`;
  };
  
  // ⭐ Year range for compact mode: use ALL occurrences being counted
  // ⭐ Year range for non-compact mode: use remainingOccurrences
  const getYearRange = () => {
    if (compactOccurrences) {
      return formatYearRange(allOccurrencesWithCompletion);
    }
    return formatYearRange(remainingOccurrences);
  };
  
  // Calculate year range for ALL occurrences (used for one-time tasks)
  const getAllYearRange = () => {
    return formatYearRange(allOccurrencesWithCompletion);
  };
  
  // Group occurrences by year for the modal (using TASK year for consistent DOM order)
  const occurrencesByYear = useMemo(() => {
    const grouped: Record<number, ReminderOccurrence[]> = {};
    
    allOccurrencesWithCompletion.forEach(occurrence => {
      const year = new Date(occurrence.calculatedTaskDateUtc).getFullYear();
      if (!grouped[year]) {
        grouped[year] = [];
      }
      grouped[year].push(occurrence);
    });
    
    // Ensure each year's occurrences are sorted by task date (ascending)
    Object.keys(grouped).forEach(yearKey => {
      grouped[Number(yearKey)].sort((a, b) => 
        new Date(a.calculatedTaskDateUtc).getTime() - new Date(b.calculatedTaskDateUtc).getTime()
      );
    });
    
    return grouped;
  }, [allOccurrencesWithCompletion]);
  
  const sortedYears = Object.keys(occurrencesByYear)
    .map(Number)
    .sort((a, b) => a - b);

  // ✅ Compute effective target date (manual override > prop > today)
  const effectiveTargetDate = useMemo(() => {
    return manualTargetDate ?? targetDate ?? new Date();
  }, [manualTargetDate, targetDate]);

  // ✅ Find nearest occurrence to target date
  const nearestOccurrence = useMemo(() => {
    if (allOccurrencesWithCompletion.length === 0) return null;

    return findNearestOccurrence(
      allOccurrencesWithCompletion.map(occ => ({
        id: occ.id,
        calculatedTaskDateUtc: occ.calculatedTaskDateUtc,
        occurrenceIndex: occ.occurrenceIndex,
      })),
      effectiveTargetDate
    );
  }, [allOccurrencesWithCompletion, effectiveTargetDate]);

  // ⭐ FIX #2: Track if we've already auto-scrolled this modal session
  const didAutoScrollRef = useRef(false);

  // ✅ Auto-scroll to nearest occurrence when modal opens (once only)
  useEffect(() => {
    // Reset flags when modal closes
    if (!showAllModal) {
      didAutoScrollRef.current = false;
      disableModalAutoScrollRef.current = false;
      return;
    }

    // Don't scroll if user has already triggered pagination (prevents race condition)
    if (disableModalAutoScrollRef.current) {
      console.debug('[AutoScroll] Skipped (user already paginated)');
      return;
    }

    // Don't scroll if we already did for this modal session
    if (didAutoScrollRef.current) {
      return;
    }

    if (!nearestOccurrence || !scrollContainerRef.current) {
      return;
    }

    // Mark that we've scrolled (set immediately to prevent double-trigger)
    didAutoScrollRef.current = true;

    // Scroll to the nearest occurrence using container-relative scroll (no scrollIntoView)
    (async () => {
      const el = scrollContainerRef.current;
      if (!el) return;

      const ok = await scrollToOccurrenceWithinContainer(el, nearestOccurrence.id, {
        align: 'center',
        behavior: 'auto',
        maxTries: 18,
      });

      if (ok) {
        setHighlightedOccurrenceId(nearestOccurrence.id);
        setTimeout(() => setHighlightedOccurrenceId(null), 2000);
      }
    })();
  }, [showAllModal, nearestOccurrence]);

  // ⭐ Restore scroll position after pagination loads new items (robust container-relative)
  useLayoutEffect(() => {
    if (!showAllModal) return;
    
    const el = scrollContainerRef.current;
    if (!el) return;

    const anchorId = pendingAppendAnchorIdRef.current;
    const dir = pendingAppendDirectionRef.current;

    // Handle pagination scroll using anchor-based targeting
    if (anchorId && dir === 'next') {
      (async () => {
        // Find anchor in the NEW post-merge sorted list
        const anchorIndex = allOccurrencesWithCompletion.findIndex(o => o.id === anchorId);
        
        if (anchorIndex >= 0 && anchorIndex < allOccurrencesWithCompletion.length - 1) {
          // Target is the occurrence immediately after the anchor
          const targetOccurrence = allOccurrencesWithCompletion[anchorIndex + 1];
          const targetId = targetOccurrence?.id;
          
          if (targetId) {
            const ok = await scrollToOccurrenceWithinContainer(el, targetId, {
              align: 'start',      // Ensure first new item becomes visible reliably
              behavior: 'auto',    // Avoid smooth reflow weirdness on repeated clicks
              maxTries: 18,
            });

            if (ok) {
              // Success: clear refs, highlight the new occurrence
              pendingAppendAnchorIdRef.current = null;
              pendingAppendDirectionRef.current = null;
              setHighlightedOccurrenceId(targetId);
              window.setTimeout(() => setHighlightedOccurrenceId(null), 2000);
              // Also clear restore fallback
              pendingScrollRestoreRef.current = null;
              return;
            }
          }
        }

        // Fallback: restore previous bottom anchor if available
        if (pendingScrollRestoreRef.current) {
          const { prevBottom, clientHeight } = pendingScrollRestoreRef.current;
          const newScrollHeight = el.scrollHeight;
          const newScrollTop = newScrollHeight - clientHeight - prevBottom;
          el.scrollTop = Math.max(0, newScrollTop);
        }

        // Clear all refs after fallback
        pendingScrollRestoreRef.current = null;
        pendingAppendAnchorIdRef.current = null;
        pendingAppendDirectionRef.current = null;
      })();
      return;
    }

    // If no target, keep existing fallback restore logic (only if restore ref set)
    if (pendingScrollRestoreRef.current) {
      const { prevBottom, clientHeight } = pendingScrollRestoreRef.current;
      const newScrollHeight = el.scrollHeight;
      const newScrollTop = newScrollHeight - clientHeight - prevBottom;
      el.scrollTop = Math.max(0, newScrollTop);
      pendingScrollRestoreRef.current = null;
    }
  }, [occurrencesMap.size, showAllModal, allOccurrencesWithCompletion]);

  // ✅ Helper to jump to a specific date
  const jumpToDate = (date: Date) => {
    setManualTargetDate(date);
    setHighlightedOccurrenceId(null);

    // Trigger scroll by finding and scrolling to new nearest
    const nearest = findNearestOccurrence(
      allOccurrencesWithCompletion.map(occ => ({
        id: occ.id,
        calculatedTaskDateUtc: occ.calculatedTaskDateUtc,
        occurrenceIndex: occ.occurrenceIndex,
      })),
      date
    );

    if (nearest && scrollContainerRef.current) {
      // Use container-relative scroll (no scrollIntoView)
      (async () => {
        const el = scrollContainerRef.current;
        if (!el) return;

        const ok = await scrollToOccurrenceWithinContainer(el, nearest.id, {
          align: 'center',
          behavior: 'auto',
          maxTries: 18,
        });

        if (ok) {
          setHighlightedOccurrenceId(nearest.id);
          setTimeout(() => setHighlightedOccurrenceId(null), 2000);
        }
      })();
    }
  };

  const today = new Date();
  
  // ✅ Hide jump buttons for one-time tasks (only 1 occurrence, no point jumping)
  const isOneTime = !effectiveIsRecurring;
  const showJumpButtons = !isOneTime && allOccurrences.length > 0;
  const showJumpToToday = showJumpButtons;
  const showJumpToSelected = showJumpButtons && targetDate && !isSameDay(targetDate, today);

  return (
    <>
      <div className={cn("space-y-3", className)}>
        {deliveryIssueMeta && (
          <Card
            className={cn(
              // "p-3 shadow-sm border text-sm",
              deliveryIssueMeta.severity === "permanent"
                ? "border-destructive/60 bg-destructive/10"
                : "border-yellow-400/60 bg-yellow-50"
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className={cn(
                  "w-4 h-4 mt-0.5 flex-shrink-0",
                  deliveryIssueMeta.severity === "permanent"
                    ? "text-destructive"
                    : "text-yellow-600"
                )}
              />
              <div className="flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {deliveryIssueMeta.message}
                  </span>
                  <Badge
                    variant={
                      deliveryIssueMeta.severity === "permanent"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-xs"
                  >
                    {deliveryIssueMeta.severity === "permanent"
                      ? "Action required"
                      : "Retrying"}
                  </Badge>
                </div>
                {deliveryIssueMeta.detail && (
                  <p className="text-xs text-muted-foreground">
                    {deliveryIssueMeta.detail}
                  </p>
                )}
                {deliveryIssueMeta.lastAttemptLabel && (
                  <p className="text-[11px] text-muted-foreground">
                    Last attempt {deliveryIssueMeta.lastAttemptLabel}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Display Recurring Task Information */}
        {recurrenceSummary && !isEmbedded && (
          <Card className="p-6 bg-teal-50/30 border border-teal-200/70 rounded-3xl shadow-sm">
            <div className="flex items-start gap-3">
              <Repeat2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-purple-600" />
              <div className="flex-1 space-y-1.5">
                <p className="text-sm text-foreground font-semibold leading-relaxed">
                  {recurrenceSummary.patternLine}
                </p>
                {recurrenceSummary.rangeLine && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {recurrenceSummary.rangeLine}
                  </p>
                )}
                {recurrenceSummary.reminderLine && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {recurrenceSummary.reminderLine}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}
        
        {/* Embedded variant: Combined recurrence summary + occurrences link */}
        {recurrenceSummary && isEmbedded && (
          <div
            className={cn(
              "w-full min-w-0 block",
              "rounded-3xl border border-teal-200/70 bg-teal-50/20 p-6",
              "shadow-[0_18px_55px_-40px_rgba(0,0,0,0.55)]",
              "text-left",
              className
            )}
          >
            {/* Recurrence info */}
            <div className="flex items-start gap-3">
              <Repeat2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-purple-600" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm text-foreground font-semibold leading-relaxed">
                  {recurrenceSummary.patternLine}
                </p>
                {recurrenceSummary.rangeLine && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {recurrenceSummary.rangeLine}
                  </p>
                )}
                {recurrenceSummary.reminderLine && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {recurrenceSummary.reminderLine}
                  </p>
                )}
              </div>
            </div>
            
            {/* Link inside container */}
            {(compactOccurrences ? allOccurrences.length > 0 : hasMoreOccurrences) && (
              <div className="border-t border-border/60 mt-4 pt-4 flex items-center justify-center w-full gap-1.5 cursor-pointer group" onClick={() => setShowAllModal(true)}>
                <span className="text-sm font-medium text-teal-600 group-hover:text-teal-700 transition-colors">
                  {nextCursor ? 'View more occurrences' : 'View occurrence details'}
                </span>
                <ChevronRight className="w-4 h-4 text-teal-600 group-hover:text-teal-700 transition-colors" />
              </div>
            )}
          </div>
        )}
        
        {/* Display Reminder Occurrences */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading reminders...</div>
        ) : !hasReminders ? (
          <Card className="p-3 bg-muted/30 border-dashed border-muted-foreground/30">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#3B82F6' }} />
              <div className="flex-1">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  No reminder notifications scheduled{isRecurring ? ' for occurrences' : ' for this task'}. You can add reminders by editing the task.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {/* Compact mode hides inline occurrences, BUT one-time must still show its single occurrence */}
            {shouldShowInlineOccurrences &&
              previewOccurrences.map((occurrence) => (
                <ReminderOccurrenceCard 
                  key={`${occurrence.id}-occurrence-${occurrence.occurrenceIndex}`}
                  occurrence={occurrence}
                  showOccurrenceNumber={effectiveIsRecurring}
                />
              ))}
            
            {/* Show link for one-time tasks in embedded variant */}
            {showOneTimeEmbeddedLink && (
              <div 
                className="flex items-center justify-center w-full gap-1.5 cursor-pointer group"
                onClick={() => setShowAllModal(true)}
              >
                <span className="text-sm font-medium text-teal-600 group-hover:text-teal-700 transition-colors">
                  {nextCursor ? 'View more occurrences' : 'View occurrence details'}
                </span>
                <ChevronRight className="w-4 h-4 text-teal-600 group-hover:text-teal-700 transition-colors" />
              </div>
            )}
            
            {/* Show button (only in default variant, embedded has it inside recurrence container) */}
            {!isEmbedded && (compactOccurrences ? allOccurrences.length > 0 : hasMoreOccurrences) && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center gap-1.5 text-sm text-teal-600 hover:text-teal-700 hover:bg-teal-50/50 transition-colors font-medium"
                onClick={() => setShowAllModal(true)}
              >
                {nextCursor ? 'View more occurrences' : 'View occurrence details'}
                <ChevronRight className="w-4 h-4 ml-0.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Modal for all occurrences grouped by year */}
      <Dialog open={showAllModal} onOpenChange={setShowAllModal}>
        <DialogContent 
          className="max-w-3xl max-h-[90vh] flex flex-col rounded-2xl"
          data-testid="occurrences-dialog"
        >
          {/* Modern header with title + buttons */}
          <DialogHeader className="space-y-0">
            <div className="flex items-start justify-between gap-6">
              {/* Left: Title + subtitle */}
              <div className="flex-1 space-y-1">
                <DialogTitle className="text-xl font-semibold">
                  All Reminder Occurrences
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Showing {allOccurrences.length} occurrence{allOccurrences.length !== 1 ? 's' : ''}{nextCursor ? ' (load more available)' : ''}
                </DialogDescription>
              </div>
              
              {/* Right: Jump buttons (only for recurring) */}
              {(showJumpToToday || showJumpToSelected) && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {showJumpToToday && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => jumpToDate(today)}
                      className="rounded-full px-4 py-2 bg-white text-black border border-black shadow-none hover:bg-gray-50 dark:bg-white dark:text-black dark:hover:bg-gray-100"
                      data-testid="btn-jump-today"
                    >
                      Jump to Today
                    </Button>
                  )}
                  {showJumpToSelected && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => jumpToDate(targetDate)}
                      className="rounded-full px-4 py-2 bg-white text-black border border-black shadow-none hover:bg-gray-50 dark:bg-white dark:text-black dark:hover:bg-gray-100"
                      data-testid="btn-jump-selected"
                    >
                      Jump to Selected
                    </Button>
                  )}
                </div>
              )}
            </div>
            
            {/* View Mode Toggle */}
            <div className="flex items-center gap-2 pt-4 pb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">View:</span>
              <div className="inline-flex rounded-lg bg-muted p-1 gap-0.5" role="tablist">
                <button
                  role="tab"
                  aria-selected={true}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                    "bg-background text-foreground shadow-sm"
                  )}
                  data-testid="view-toggle-cards"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Cards
                </button>
                <button
                  role="tab"
                  aria-selected={false}
                  onClick={() => {
                    // Close modal and navigate to full page timeline
                    setShowAllModal(false);
                    navigate(`/occurrences/${entityType}/${baseEntityId}/timeline`);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                    "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                  data-testid="view-toggle-timeline"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Timeline
                </button>
              </div>
            </div>
          </DialogHeader>
          
          {/* Scrollable content - Cards view only (Timeline is now full page) */}
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto pr-3 space-y-6"
            style={{ overflowAnchor: "none" }}
          >
            {sortedYears.map((year) => (
              <div key={year} className="space-y-4">
                {/* Year header with icon + count */}
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Clock className="w-4 h-4 text-orange-500" />
                  <h3 className="text-base font-semibold text-foreground">
                    {year}
                  </h3>
                  <span className="text-sm text-muted-foreground">
                    ({occurrencesByYear[year].length} occurrence{occurrencesByYear[year].length !== 1 ? 's' : ''})
                  </span>
                </div>
                
                {/* Occurrence cards */}
                <div className="space-y-4 mt-3">
                  {occurrencesByYear[year].map((occurrence) => (
                    <ReminderOccurrenceCard 
                      key={occurrence.id}
                      occurrence={occurrence}
                      showOccurrenceNumber={effectiveIsRecurring}
                      isHighlighted={highlightedOccurrenceId === occurrence.id}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* ⭐ Load more button at the bottom */}
            {nextCursor && (
              <div className="flex justify-center py-4">
                <Button
                  variant="outline"
                  size="default"
                  onClick={() => loadMore('next')}
                  disabled={isLoadingMore}
                  className="rounded-full px-6 py-2"
                >
                  {isLoadingMore ? 'Loading...' : 'Load more (next 10)'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

