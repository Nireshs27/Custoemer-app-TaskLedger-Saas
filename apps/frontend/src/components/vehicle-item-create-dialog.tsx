import { useEffect, useMemo, useState } from "react";
import { useForm, UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Clock, Plus, X, Repeat, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { format, addDays, getDate, getDay } from "date-fns";
import { cn } from "@/lib/utils";
import { TimePicker12H } from "@/components/ui/time-picker-12h";
import {
  normalizeRecurrenceForUi,
  sanitizeRecurrenceForSave,
} from "@/lib/recurrence-utils";
import { buildPreviewIsoStrings } from "@/lib/occurrence-engine";
import { recurrenceDataSchema } from "@shared/recurrence-validation";

type RecurrenceData = z.infer<typeof recurrenceDataSchema>;
import { 
  optimisticCreateVehicleItem,
  optimisticUpdateVehicleItem,
  rollbackVehicleItemQueries,
  invalidateVehicleItemQueries,
  generateTempId,
  addItemOptimistically,
  cancelCalendarQueries,
  invalidateCalendarQueries,
} from "@/lib/optimistic-updates";
import { Label } from "@/components/ui/label";
import { combineDateAndTimeToIso, parseDateWithOptionalTime } from "@/lib/datetime";
import {
  ReminderOffsetUnit,
  convertOffsetToDaysEstimate,
  toLegacyReminderDays,
  formatOffsetSummary,
  DEFAULT_REMINDER_OFFSET_VALUE,
  DEFAULT_REMINDER_OFFSET_UNIT,
} from "@/lib/reminder-offset";

const REMINDER_OFFSET_OPTIONS: { value: ReminderOffsetUnit; label: string }[] = [
  { value: 'minutes', label: 'Minute(s)' },
  { value: 'hours', label: 'Hour(s)' },
  { value: 'days', label: 'Day(s)' },
];

const MONTHLY_ORDINALS = ["first", "second", "third", "fourth", "last"] as const;
type MonthlyOrdinal = (typeof MONTHLY_ORDINALS)[number];
const isMonthlyOrdinal = (value: unknown): value is MonthlyOrdinal =>
  typeof value === "string" && (MONTHLY_ORDINALS as readonly string[]).includes(value);
const asMonthlyOrdinal = (value: unknown, fallback: MonthlyOrdinal = "first"): MonthlyOrdinal =>
  isMonthlyOrdinal(value) ? value : fallback;

const formatPreviewOccurrence = (value: string) => {
  try {
    return format(new Date(value), "MMM d, yyyy h:mm a");
  } catch (error) {
    console.warn('Failed to format preview occurrence', value, error);
    return value;
  }
};

// Pure helper so we can unit-test auto-alignment without rendering the component.
export function syncStartDateToPreview(params: {
  autoAlignStart: boolean;
  previewFirstDateOnly: string | null;
  previewOccurrences: string[];
  getDueDate: () => string | undefined;
  setDueDate: (value: string) => void;
  getRecurrence: () => RecurrenceData | null | undefined;
  setRecurrence: (value: RecurrenceData) => void;
}) {
  const {
    autoAlignStart,
    previewFirstDateOnly,
    previewOccurrences,
    getDueDate,
    setDueDate,
    getRecurrence,
    setRecurrence,
  } = params;

  if (!autoAlignStart || !previewFirstDateOnly) return;

  const currentDue = getDueDate();
  if (currentDue !== previewFirstDateOnly) {
    setDueDate(previewFirstDateOnly);
  }

  const currentRec = getRecurrence();
  if (!currentRec) return;
  const nextStart = previewOccurrences[0] ?? previewFirstDateOnly;
  if (currentRec.startDate !== nextStart) {
    const nextRec: RecurrenceData = { ...currentRec, startDate: nextStart };
    setRecurrence(nextRec);
  }
}

/**
 * Get sensible default occurrence count based on recurrence pattern
 * Provides 1 year's worth of occurrences for most patterns
 */
function getDefaultOccurrenceCount(pattern: string): number {
  switch (pattern) {
    case 'daily': return 365;        // 1 year of daily tasks
    case 'weekly': return 52;        // 1 year of weekly tasks
    case 'monthly': return 12;       // 1 year of monthly tasks
    case 'quarterly': return 4;      // 1 year of quarterly tasks
    case 'half-yearly': return 2;    // 1 year of half-yearly tasks
    case 'yearly': return 1;         // 1 year
    default: return 12;              // Default: 12 occurrences
  }
}

export interface OneTimeScheduleSummaryInput {
  dueDate?: string | null;
  occurrenceTime?: string | null;
  reminderTime?: string | null;
  reminderOffsetValue?: number | null;
  reminderOffsetUnit?: ReminderOffsetUnit | null;
}

export interface OneTimeScheduleSummary {
  taskLine: string;
  reminderLine: string;
}

export function buildOneTimeScheduleSummary(
  input: OneTimeScheduleSummaryInput
): OneTimeScheduleSummary {
  const dueDate = parseDateWithOptionalTime(
    input.dueDate,
    input.occurrenceTime
  );
  const taskLine = dueDate
    ? `Task date & time: ${format(dueDate, "MMM d, yyyy 'at' h:mm a")}`
    : "Task date & time unavailable";

  const reminderTimeLabel = formatTimeLabel(
    input.reminderTime || input.occurrenceTime
  );

  const offsetValue =
    typeof input.reminderOffsetValue === "number"
      ? input.reminderOffsetValue
      : DEFAULT_REMINDER_OFFSET_VALUE;
  const offsetUnit =
    (input.reminderOffsetUnit as ReminderOffsetUnit | undefined) ||
    DEFAULT_REMINDER_OFFSET_UNIT;

  const reminderLine = `Reminder: ${formatOffsetSummary(
    offsetValue,
    offsetUnit
  )} before at ${reminderTimeLabel}`;

  return { taskLine, reminderLine };
}

export interface OneTimeEditPresentationInput {
  mode: "create" | "edit";
  reminderSent: boolean;
  isCompleted: boolean;
}

export interface OneTimeEditPresentation {
  showTaskTypeToggle: boolean;
  showScheduleSummary: boolean;
  lockReminderConfig: boolean;
}

export function getOneTimeEditPresentation(
  input: OneTimeEditPresentationInput
): OneTimeEditPresentation {
  const isEditMode = input.mode === "edit";
  const lockReminderConfig =
    isEditMode && (input.reminderSent || input.isCompleted);
  return {
    showTaskTypeToggle: !isEditMode,
    showScheduleSummary: isEditMode,
    lockReminderConfig,
  };
}

function formatTimeLabel(value?: string | null): string {
  if (!value || !value.includes(":")) {
    return "unspecified time";
  }
  const [hoursStr, minutesStr] = value.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return value;
  }
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return format(date, "h:mm a");
}

// ✅ Schema for both one-time and recurring (backend compatible)
const vehicleTaskSchema = z.object({
  title: z.string().min(1, "Task name is required"),
  dueDate: z.string().min(1, "Due date is required"),
  description: z.string().optional(),
  reminderDays: z.number().min(0, "Cannot be negative"),
  reminderOffsetValue: z.number().int("Offset must be a whole number").min(1, "Offset must be at least 1").max(100000, "Offset too large"),
  reminderOffsetUnit: z.enum(['minutes', 'hours', 'days']),
  reminderTimes: z.array(z.string()).min(1, "At least one time is required"),
  notificationChannels: z.array(z.string()).min(1, "At least one channel is required"),
  emailRecipients: z.array(z.string().email("Invalid email")).optional(),
  isRecurring: z.boolean(),
  recurrenceData: recurrenceDataSchema.optional().nullable(),  // ⭐ STRICT VALIDATION
});
// ℹ️ NOTE: Email requirement validation is handled in handleOneTimeSubmit/handleRecurringSubmit
// because emailRecipients are managed in separate state (not in form state)

type VehicleTaskForm = z.infer<typeof vehicleTaskSchema>;

interface VehicleItemCreateDialogProps {
  mode?: "create" | "edit";  // ✅ NEW: Mode prop (defaults to "create")
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string; // For task actions, pass taskActionId here
  vehicleName: string;
  vehicleItemId?: string;  // ✅ NEW: Required for edit mode
  initialData?: Partial<VehicleTaskForm>;  // ✅ NEW: Pre-populate form for edit mode
  onSuccess?: () => void;
  limitRecurringEditFields?: boolean;
  oneTimeReminderState?: {
    reminderSent: boolean;
    isCompleted: boolean;
  };
  entityKind?: "vehicle" | "asset" | "task_action" | "tax_legal";
  editMetadataOnly?: boolean;  // ✅ NEW: Enable metadata-only editing (title, contacts, recipients)
}

export function VehicleItemCreateDialog({
  mode = "create",  // ✅ Default to create mode
  open,
  onOpenChange,
  vehicleId,
  vehicleName,
  vehicleItemId,
  initialData,
  onSuccess,
  limitRecurringEditFields = false,
  oneTimeReminderState,
  entityKind = "vehicle",
  editMetadataOnly = false,  // ✅ Default to false
}: VehicleItemCreateDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAsset = entityKind === "asset";
  const isTaskAction = entityKind === "task_action";
  const isTaxLegal = entityKind === "tax_legal";
  const itemsQueryKey = isAsset
    ? `/api/assets/${vehicleId}/tasks`
    : isTaskAction
    ? `/api/task-actions/${vehicleId}/tasks`
    : isTaxLegal
    ? `/api/tax-legal-compliances/${vehicleId}/items`
    : "/api/vehicle-items";

  const isEditMode = mode === "edit";
  const initialIsRecurring = !!initialData?.isRecurring;

  const shouldLimitRecurringEdit = isEditMode && initialIsRecurring && limitRecurringEditFields;

  // ✅ Toggle state for switching between One-Time and Recurring
  // Initialize from initialData if in edit mode
  const [taskType, setTaskType] = useState<'one-time' | 'recurring'>(
    isEditMode && initialIsRecurring ? 'recurring' : 'one-time'
  );

  const disableOneTimeTab = isEditMode && initialIsRecurring;
  const disableRecurringTab = isEditMode && !initialIsRecurring;
  const canSwitchTaskType = !isEditMode;

  const handleTaskTypeSelect = (nextType: 'one-time' | 'recurring') => {
    if (!canSwitchTaskType) {
      return;
    }
    setTaskType(nextType);
  };

  useEffect(() => {
    if (shouldLimitRecurringEdit) {
      setTaskType('recurring');
    }
  }, [shouldLimitRecurringEdit]);

  // ✅ State for email recipients (shared between sections)
  // Initialize from initialData if in edit mode
  const [oneTimeEmailRecipients, setOneTimeEmailRecipients] = useState<string[]>(
    isEditMode && !initialIsRecurring && initialData?.emailRecipients
      ? initialData.emailRecipients
      : []
  );
  const [recurringEmailRecipients, setRecurringEmailRecipients] = useState<string[]>(
    mode === "edit" && initialData?.isRecurring && initialData?.emailRecipients 
      ? initialData.emailRecipients 
      : []
  );
  const [oneTimeEmailInput, setOneTimeEmailInput] = useState("");
  const [recurringEmailInput, setRecurringEmailInput] = useState("");

  // ✅ State for contacts (shared between sections)
  type Contact = { id: string; name: string; mobile: string; designation: string };
  const [oneTimeContacts, setOneTimeContacts] = useState<Contact[]>([]);
  const [recurringContacts, setRecurringContacts] = useState<Contact[]>([]);
  const [oneTimeContactErrors, setOneTimeContactErrors] = useState<Record<string, string>>({});
  const [recurringContactErrors, setRecurringContactErrors] = useState<Record<string, string>>({});
  const [metadataContactErrors, setMetadataContactErrors] = useState<Record<string, string>>({});

  const generateContactId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  // ✅ MOBILE VALIDATION HELPERS
  /**
   * Normalize mobile number: remove spaces, hyphens, parentheses
   * Keep leading + if present
   */
  const normalizeMobile = (input: string): string => {
    if (!input) return '';
    const trimmed = input.trim();
    // Keep + at start, remove all non-digit characters except leading +
    const hasPlus = trimmed.startsWith('+');
    const digitsOnly = trimmed.replace(/[^0-9]/g, '');
    return hasPlus ? `+${digitsOnly}` : digitsOnly;
  };

  /**
   * Validate normalized mobile number
   * Accepts 10-15 digits (with or without leading +)
   */
  const isValidMobile = (normalized: string): boolean => {
    if (!normalized) return false;
    const digitsOnly = normalized.replace(/^\+/, '');
    const digitCount = digitsOnly.length;
    // Must be 10-15 digits, and all digits
    return digitCount >= 10 && digitCount <= 15 && /^[0-9]+$/.test(digitsOnly);
  };

  /**
   * Validate a contact row's mobile field
   * Returns error message or null
   */
  const validateContactMobile = (contact: Contact): string | null => {
    const hasAnyField = contact.name.trim() || contact.mobile.trim() || contact.designation.trim();
    
    // If row is completely empty, it's ok (will be filtered out)
    if (!hasAnyField) return null;
    
    // If row has any field, mobile must be valid
    if (!contact.mobile.trim()) {
      return 'Mobile is required for active contacts';
    }
    
    const normalized = normalizeMobile(contact.mobile);
    if (!isValidMobile(normalized)) {
      return 'Enter a valid mobile number (10–15 digits). You may include +country code.';
    }
    
    return null;
  };

  /**
   * Sanitize contacts: validate all, normalize valid ones, filter empty
   * Returns { sanitizedContacts, errors }
   */
  const sanitizeContacts = (contacts: Contact[]): { 
    sanitizedContacts: Array<{ id: string; name: string; mobile: string; designation: string | null }>;
    errors: Record<string, string>;
  } => {
    const errors: Record<string, string> = {};
    const sanitizedContacts: Array<{ id: string; name: string; mobile: string; designation: string | null }> = [];
    
    for (const contact of contacts) {
      const hasAnyField = contact.name.trim() || contact.mobile.trim() || contact.designation.trim();
      
      // Skip completely empty rows
      if (!hasAnyField) continue;
      
      // Validate mobile
      const error = validateContactMobile(contact);
      if (error) {
        errors[contact.id] = error;
        continue;
      }
      
      // Normalize and add to sanitized list
      const normalized = normalizeMobile(contact.mobile);
      sanitizedContacts.push({
        id: contact.id,
        name: contact.name.trim(),
        mobile: normalized,
        designation: contact.designation.trim() || null,
      });
    }
    
    return { sanitizedContacts, errors };
  };

  const addOneTimeContact = () => {
    setOneTimeContacts([...oneTimeContacts, { id: generateContactId(), name: '', mobile: '', designation: '' }]);
  };

  const removeOneTimeContact = (id: string) => {
    setOneTimeContacts(oneTimeContacts.filter(c => c.id !== id));
    // Clear error for removed contact
    setOneTimeContactErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateOneTimeContact = (id: string, field: keyof Contact, value: string) => {
    setOneTimeContacts(oneTimeContacts.map(c => c.id === id ? { ...c, [field]: value } : c));
    // Clear error when user types
    if (oneTimeContactErrors[id]) {
      setOneTimeContactErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const validateOneTimeContactMobile = (id: string) => {
    const contact = oneTimeContacts.find(c => c.id === id);
    if (!contact) return;
    
    const error = validateContactMobile(contact);
    if (error) {
      setOneTimeContactErrors(prev => ({ ...prev, [id]: error }));
    }
  };

  const addRecurringContact = () => {
    setRecurringContacts([...recurringContacts, { id: generateContactId(), name: '', mobile: '', designation: '' }]);
  };

  const removeRecurringContact = (id: string) => {
    setRecurringContacts(recurringContacts.filter(c => c.id !== id));
    // Clear error for removed contact
    setRecurringContactErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateRecurringContact = (id: string, field: keyof Contact, value: string) => {
    setRecurringContacts(recurringContacts.map(c => c.id === id ? { ...c, [field]: value } : c));
    // Clear error when user types
    if (recurringContactErrors[id]) {
      setRecurringContactErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const validateRecurringContactMobile = (id: string) => {
    const contact = recurringContacts.find(c => c.id === id);
    if (!contact) return;
    
    const error = validateContactMobile(contact);
    if (error) {
      setRecurringContactErrors(prev => ({ ...prev, [id]: error }));
    }
  };

  // ✅ METADATA-ONLY EDIT: Fetch current recipients from occurrence_reminders
  const entityTypeMap = {
    vehicle: 'vehicle_item',
    asset: 'asset_item',
    task_action: 'task_action_item',
    tax_legal: 'tax_legal_item',
  };
  const entityTypeForReminders = entityTypeMap[entityKind];
  
  const { data: currentRecipientsData } = useQuery<{ recipients: string[] }>({
    queryKey: [`/api/task-metadata/${entityTypeForReminders}/${vehicleItemId}/recipients`],
    enabled: editMetadataOnly && isEditMode && !!vehicleItemId,
  });

  // ✅ METADATA-ONLY EDIT: State for metadata form
  const [metadataTitle, setMetadataTitle] = useState(initialData?.title || "");
  const [metadataContacts, setMetadataContacts] = useState<Contact[]>([]);
  const [metadataEmailRecipients, setMetadataEmailRecipients] = useState<string[]>([]);
  const [metadataEmailInput, setMetadataEmailInput] = useState("");
  const [metadataContactsDirty, setMetadataContactsDirty] = useState(false);  // ✅ Track if contacts were modified
  
  // ✅ Email Recipients Editability Status (from backend)
  const [shouldLockEmailRecipients, setShouldLockEmailRecipients] = useState(false);
  const [eligibleUpcomingUnsentCount, setEligibleUpcomingUnsentCount] = useState(0);
  const [futureGenerationPossible, setFutureGenerationPossible] = useState(false);

  // ✅ Helper to safely parse custom_fields (can be string or object)
  const parseCustomFields = (customFields: any): any => {
    if (!customFields) {
      console.log('📦 custom_fields is null/undefined');
      return {};
    }
    if (typeof customFields === 'string') {
      try {
        const parsed = JSON.parse(customFields);
        console.log('📦 Parsed custom_fields from string:', parsed);
        return parsed;
      } catch (e) {
        console.warn('❌ Failed to parse custom_fields:', e);
        return {};
      }
    }
    if (typeof customFields === 'object') {
      console.log('📦 custom_fields is already object:', customFields);
      return customFields;
    }
    console.warn('⚠️ custom_fields has unexpected type:', typeof customFields);
    return {};
  };

  // ✅ Initialize metadata form when dialog opens (resets on every open to prevent stale data)
  useEffect(() => {
    if (editMetadataOnly && open) {
      console.log('🔄 Resetting metadata form for task:', vehicleItemId);
      setMetadataTitle(initialData?.title || "");
      setMetadataContactsDirty(false);  // ✅ Reset dirty flag on open
      
      // ✅ Load contacts from parent task customFields (support both snake_case and camelCase)
      const rawCustomFields = (initialData as any)?.customFields || (initialData as any)?.custom_fields;
      const customFields = parseCustomFields(rawCustomFields);
      
      if (customFields && Array.isArray(customFields.contacts)) {
        // Ensure each contact has an id and proper defaults
        const contactsWithIds = customFields.contacts.map((c: any) => ({
          id: c.id || generateContactId(),
          name: c.name || '',
          mobile: c.mobile || '',
          designation: c.designation === null ? '' : (c.designation || ''),
        }));
        setMetadataContacts(contactsWithIds);
        console.log('✅ Loaded contacts:', contactsWithIds.length);
      } else {
        setMetadataContacts([]);
        console.log('⚠️ No contacts found');
      }
      
      // ✅ Load recipients from parent task emailRecipients (primary source after cache update)
      const recipients = initialData?.emailRecipients || currentRecipientsData?.recipients || [];
      setMetadataEmailRecipients(recipients);
      console.log('✅ Loaded email recipients:', recipients.length);
      
      // ✅ Compute initial editability status (conservative client-side estimation)
      const isRecurring = (initialData as any)?.isRecurring || !!(initialData as any)?.recurrenceData;
      const nextDueDate = (initialData as any)?.nextDueDate;
      const today = new Date().toISOString().split('T')[0];
      
      // Conservative: assume future generation is possible if recurring and has next_due_date >= today
      let futureGenPossible = false;
      if (isRecurring && nextDueDate && nextDueDate >= today) {
        futureGenPossible = true;
      }
      
      // Initially assume NOT locked (optimistic), backend will correct after first save
      // This prevents premature locking before we know the real eligible count
      setFutureGenerationPossible(futureGenPossible);
      setShouldLockEmailRecipients(false);  // Start unlocked, backend will update if needed
      setEligibleUpcomingUnsentCount(0);  // Will be set from backend on save
      
      console.log('📊 Initial editability: futureGenPossible=', futureGenPossible, 'locked=false (optimistic)');
    }
  }, [editMetadataOnly, open, vehicleItemId, initialData, currentRecipientsData]);

  const addMetadataContact = () => {
    setMetadataContacts([...metadataContacts, { id: generateContactId(), name: '', mobile: '', designation: '' }]);
    setMetadataContactsDirty(true);  // ✅ Mark as dirty
  };

  const removeMetadataContact = (id: string) => {
    setMetadataContacts(metadataContacts.filter(c => c.id !== id));
    setMetadataContactsDirty(true);  // ✅ Mark as dirty
    // Clear error for removed contact
    setMetadataContactErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const updateMetadataContact = (id: string, field: keyof Contact, value: string) => {
    setMetadataContacts(metadataContacts.map(c => c.id === id ? { ...c, [field]: value } : c));
    setMetadataContactsDirty(true);  // ✅ Mark as dirty
    // Clear error when user types
    if (metadataContactErrors[id]) {
      setMetadataContactErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const validateMetadataContactMobile = (id: string) => {
    const contact = metadataContacts.find(c => c.id === id);
    if (!contact) return;
    
    const error = validateContactMobile(contact);
    if (error) {
      setMetadataContactErrors(prev => ({ ...prev, [id]: error }));
    }
  };

  // ✅ Today helper for default dates
  const today = format(new Date(), "yyyy-MM-dd");

  // ✅ Form for ONE-TIME tasks
  const oneTimeForm = useForm<VehicleTaskForm>({
    resolver: zodResolver(vehicleTaskSchema),
    defaultValues: mode === "edit" && initialData ? {
      title: initialData.title || "",
      dueDate: initialData.dueDate?.split('T')[0] || today,
      description: initialData.description || "",
      reminderDays: initialData.reminderDays || 7,
      reminderOffsetValue: initialData.reminderOffsetValue || initialData.reminderDays || DEFAULT_REMINDER_OFFSET_VALUE,
      reminderOffsetUnit: (initialData.reminderOffsetUnit as ReminderOffsetUnit) || DEFAULT_REMINDER_OFFSET_UNIT,
      reminderTimes: initialData.reminderTimes || ["09:00"],
      notificationChannels: initialData.notificationChannels || ["email"],
      emailRecipients: initialData.emailRecipients || [],
      isRecurring: false,
      recurrenceData: null,
    } : {
      title: "",
      dueDate: today,
      description: "",
      reminderDays: 7,
      reminderOffsetValue: DEFAULT_REMINDER_OFFSET_VALUE,
      reminderOffsetUnit: DEFAULT_REMINDER_OFFSET_UNIT,
      reminderTimes: ["09:00"],
      notificationChannels: ["email"],
      emailRecipients: [],
      isRecurring: false,
      recurrenceData: null,
    },
  });

// ✅ Form for RECURRING tasks
const recurringForm = useForm<VehicleTaskForm>({
    resolver: zodResolver(vehicleTaskSchema),
    defaultValues: mode === "edit" && initialData ? {
      title: initialData.title || "",
      dueDate: initialData.dueDate?.split('T')[0] || today,
      description: initialData.description || "",
      reminderDays: initialData.reminderDays || 7,
      reminderOffsetValue: initialData.reminderOffsetValue || initialData.reminderDays || DEFAULT_REMINDER_OFFSET_VALUE,
      reminderOffsetUnit: (initialData.reminderOffsetUnit as ReminderOffsetUnit) || DEFAULT_REMINDER_OFFSET_UNIT,
      reminderTimes: initialData.reminderTimes || ["09:00"],
      notificationChannels: initialData.notificationChannels || ["email"],
      emailRecipients: initialData.emailRecipients || [],
      isRecurring: true,
      recurrenceData: initialData.recurrenceData || {
        pattern: 'daily',
        interval: 1,
        endType: 'after',
        endCount: 10,
        weekDays: [getDay(new Date())],
        monthlyType: 'date',
        monthlyDate: getDate(new Date()),
        startDate: new Date(),
      },
    } : {
      title: "",
      dueDate: today,
      description: "",
      reminderDays: 7,
      reminderOffsetValue: DEFAULT_REMINDER_OFFSET_VALUE,
      reminderOffsetUnit: DEFAULT_REMINDER_OFFSET_UNIT,
      reminderTimes: ["09:00"],
      notificationChannels: ["email"],
      emailRecipients: [],
      isRecurring: true,
      recurrenceData: {
        pattern: 'daily',
        interval: 1,
        endType: 'after',
        endCount: 10,
        weekDays: [getDay(new Date())],
        monthlyType: 'date',
        monthlyDate: getDate(new Date()),
        startDate: new Date(),
      },
    },
  });

  const isEditingOneTime = isEditMode && !initialIsRecurring;
  const oneTimeReminderSent =
    isEditingOneTime && !!oneTimeReminderState?.reminderSent;
  const oneTimeCompleted =
    isEditingOneTime && !!oneTimeReminderState?.isCompleted;
  const oneTimeUiState = getOneTimeEditPresentation({
    mode,
    reminderSent: !!oneTimeReminderState?.reminderSent,
    isCompleted: !!oneTimeReminderState?.isCompleted,
  });
  const lockOneTimeReminderConfig =
    isEditingOneTime && oneTimeUiState.lockReminderConfig;
  const canEditOneTimeStructure = !lockOneTimeReminderConfig;

const ReminderOffsetFields = ({
  formInstance,
  disabled = false,
}: {
  formInstance: UseFormReturn<VehicleTaskForm>;
  disabled?: boolean;
}) => (
  <div className="mb-4">
    <Label className="text-sm font-medium">Remind me before each occurrence</Label>
    <div className="flex flex-wrap gap-2 mt-2 items-end">
      <FormField
        control={formInstance.control}
        name="reminderOffsetValue"
        render={({ field }) => (
          <FormItem className="w-full sm:w-24">
            <FormControl>
              <Input
                type="number"
                min={1}
                {...field}
                onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={formInstance.control}
        name="reminderOffsetUnit"
        render={({ field }) => (
          <FormItem className="w-full sm:w-36">
            <Select
              onValueChange={field.onChange}
              value={field.value}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {REMINDER_OFFSET_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />
      <div className="text-sm text-muted-foreground pb-2">
        before each occurrence
      </div>
    </div>
    <p className="text-xs text-muted-foreground mt-2">
      Tip: minutes/hours are great for quick testing. Use days for real-world schedules.
    </p>
  </div>
);

  const recurringDueDateValue = recurringForm.watch('dueDate');
  const recurringReminderTimesValue = recurringForm.watch('reminderTimes');
  const recurrenceDataWatch = recurringForm.watch('recurrenceData');
  const previewStartDateValue = recurringDueDateValue || new Date().toISOString().split('T')[0];
  const previewOccurrenceTime = recurringReminderTimesValue?.[0] || '09:00';

  const [recurrencePreview, setRecurrencePreview] = useState<string[]>([]);
  const [recurrencePreviewError, setRecurrencePreviewError] = useState<string | null>(null);
  const [recurrencePreviewLoading, setRecurrencePreviewLoading] = useState(false);
  const previewOccurrences = useMemo(() => recurrencePreview.slice(0, 10), [recurrencePreview]);
  const previewFirstDateOnly = useMemo(() => {
    const first = previewOccurrences[0];
    if (!first) return null;
    try {
      return new Date(first).toISOString().split("T")[0];
    } catch {
      return null;
    }
  }, [previewOccurrences]);
  // Auto-align disabled for manual control; snap happens on submit
  const autoAlignStart = false;
  // Start Date should always be editable for all recurrence patterns
  const startDateDisabled = false;

  const previewConfigKey = useMemo(() => {
    if (!recurrenceDataWatch?.pattern || !recurrenceDataWatch?.interval || !previewStartDateValue) {
      return null;
    }
    const payload = {
      startDate: previewStartDateValue,
      occurrenceTime: previewOccurrenceTime,
      recurrenceData: {
        pattern: recurrenceDataWatch.pattern,
        interval: recurrenceDataWatch.interval,
        weekDays: recurrenceDataWatch.weekDays ?? [],
        monthlyType: recurrenceDataWatch.monthlyType,
        monthlyDate: recurrenceDataWatch.monthlyDate,
        monthlyOrdinal: recurrenceDataWatch.monthlyOrdinal,
        monthlyWeekday: recurrenceDataWatch.monthlyWeekday,
        endType: recurrenceDataWatch.endType || 'never',
        endDate: recurrenceDataWatch.endDate,
        endCount: recurrenceDataWatch.endCount,
      },
      count: 10,
    };
    return JSON.stringify(payload);
  }, [
    previewStartDateValue,
    previewOccurrenceTime,
    recurrenceDataWatch?.pattern,
    recurrenceDataWatch?.interval,
    recurrenceDataWatch?.weekDays?.join(',') ?? '',
    recurrenceDataWatch?.monthlyType ?? '',
    recurrenceDataWatch?.monthlyDate ?? '',
    recurrenceDataWatch?.monthlyOrdinal ?? '',
    recurrenceDataWatch?.monthlyWeekday ?? '',
    recurrenceDataWatch?.endType ?? '',
    recurrenceDataWatch?.endDate ?? '',
    recurrenceDataWatch?.endCount ?? '',
  ]);

  useEffect(() => {
    if (!previewConfigKey) {
      setRecurrencePreview([]);
      setRecurrencePreviewError(null);
      return;
    }

    let cancelled = false;
    setRecurrencePreviewLoading(true);
    setRecurrencePreviewError(null);

    try {
      const payload = JSON.parse(previewConfigKey);
      const seriesStart =
        payload.startDate && typeof payload.startDate === "string"
          ? new Date(`${payload.startDate}T00:00:00.000Z`)
          : new Date();

      const previewIso = buildPreviewIsoStrings({
        recurrence: payload.recurrenceData,
        seriesStart,
        count: payload.count ?? 10,
        taskTimeIst: payload.occurrenceTime ?? "09:00",
      });

      if (!cancelled) {
        setRecurrencePreview(previewIso);
        setRecurrencePreviewError(null);
      }
    } catch (error: any) {
      if (!cancelled) {
        const message =
          error?.message ||
          error?.response?.data?.message ||
          "Unable to generate recurrence preview.";
        setRecurrencePreviewError(message);
        setRecurrencePreview([]);
      }
    } finally {
      if (!cancelled) {
        setRecurrencePreviewLoading(false);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [previewConfigKey]);

  // Auto-align start date to first preview occurrence when enabled
  useEffect(() => {
    syncStartDateToPreview({
      autoAlignStart,
      previewFirstDateOnly,
      previewOccurrences,
      getDueDate: () => recurringForm.getValues("dueDate"),
      setDueDate: (value) => recurringForm.setValue("dueDate", value, { shouldDirty: true }),
      getRecurrence: () => recurringForm.getValues("recurrenceData") || null,
      setRecurrence: (value) =>
        recurringForm.setValue("recurrenceData", value, { shouldDirty: true }),
    });
  }, [autoAlignStart, previewFirstDateOnly, previewOccurrences, recurringForm]);

  const oneTimeOffsetUnit = oneTimeForm.watch('reminderOffsetUnit');
  const oneTimeOffsetValue = oneTimeForm.watch('reminderOffsetValue');
  const oneTimeReminderTimesValue = oneTimeForm.watch('reminderTimes');
  const oneTimeDueDateValue = oneTimeForm.watch('dueDate');
  const isOneTimeDayOffset = oneTimeOffsetUnit === 'days';
  const isOneTimeSubDayOffset = oneTimeOffsetUnit === 'minutes' || oneTimeOffsetUnit === 'hours';

  const recurringOffsetUnit = recurringForm.watch('reminderOffsetUnit');
  const recurringOffsetValue = recurringForm.watch('reminderOffsetValue');
  const isRecurringDayOffset = recurringOffsetUnit === 'days';
  const isRecurringSubDayOffset = recurringOffsetUnit === 'minutes' || recurringOffsetUnit === 'hours';

useEffect(() => {
  if (shouldLimitRecurringEdit && initialData) {
    recurringForm.reset({
      ...(recurringForm.getValues() as VehicleTaskForm),
      title: initialData.title || "",
      description: initialData.description || "",
      notificationChannels: initialData.notificationChannels || ["email"],
    });
  }
}, [shouldLimitRecurringEdit, initialData, recurringForm]);

  // ✅ Mutation (works for both create and edit modes)
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const emailRecipientsToUse = data._emailRecipients || [];
      const legacyReminderDays = toLegacyReminderDays(data.reminderOffsetValue, data.reminderOffsetUnit);
      
      // ✅ Build payload - vehicleId only for create mode (edit doesn't allow changing vehicle)
      const itemData: any = {
        title: data.title,
        description: data.description || '',
        category: data.category,
        isRecurring: data.isRecurring,
        dueDate: data.dueDate,
        status: 'pending',
        reminderDays: legacyReminderDays,
        reminderOffsetValue: data.reminderOffsetValue,
        reminderOffsetUnit: data.reminderOffsetUnit,
        reminderTimes: data.reminderTimes,
        notificationChannels: data.notificationChannels,
        emailRecipients: emailRecipientsToUse,
        recurrenceData: data.isRecurring ? data.recurrenceData : null,
      };

      // ✅ Add contacts to custom_fields if any exist
      const contactsToUse = data.isRecurring ? recurringContacts : oneTimeContacts;
      if (contactsToUse.length > 0) {
        const { sanitizedContacts } = sanitizeContacts(contactsToUse);
        
        // ✅ Only set customFields.contacts if there are valid contacts (don't force empty array)
        if (sanitizedContacts.length > 0) {
          itemData.customFields = { contacts: sanitizedContacts };
        }
      }

      // ✅ Only include vehicleId for CREATE mode (not allowed in UPDATE)
      if (mode === "create") {
        if (isAsset) {
          itemData.assetId = vehicleId;
        } else if (isTaskAction) {
          itemData.taskActionId = vehicleId;
        } else if (isTaxLegal) {
          // complianceId is derived from the route; keep payload compatible with vehicle task form
        } else {
          itemData.vehicleId = vehicleId;
        }
      }

      // ✅ Only allow CREATE mode - editing is disabled
      if (mode === "edit") {
        // Prevent edit - this should never be called since UI is disabled
        throw new Error("Editing is disabled. Please delete and recreate the task.");
      }
      
      // Create mode only
      if (isAsset) {
        return apiRequest('POST', `/api/assets/${vehicleId}/tasks`, itemData);
      }
      if (isTaskAction) {
        return apiRequest('POST', `/api/task-actions/${vehicleId}/tasks`, itemData);
      }
      if (isTaxLegal) {
        return apiRequest('POST', `/api/tax-legal-compliances/${vehicleId}/items`, itemData);
      }
      return apiRequest('POST', '/api/vehicle-items', itemData);
    },
    onMutate: async (data) => {
      if (isAsset) {
        onOpenChange(false);
        return {};
      }
      const emailRecipientsToUse = data._emailRecipients || [];
      const legacyReminderDays = toLegacyReminderDays(data.reminderOffsetValue, data.reminderOffsetUnit);
      
      const optimisticVehicleItem = {
        id: generateTempId(), // Always create (edit mode is disabled)
        vehicleId,
        title: data.title,
        description: data.description || '',
        category: data.category,
        isRecurring: data.isRecurring,
        dueDate: data.dueDate,
        status: 'pending',
        reminderDays: legacyReminderDays,
        reminderOffsetValue: data.reminderOffsetValue,
        reminderOffsetUnit: data.reminderOffsetUnit,
        reminderTimes: data.reminderTimes,
        notificationChannels: data.notificationChannels,
        emailRecipients: emailRecipientsToUse,
        recurrenceData: data.isRecurring ? data.recurrenceData : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      // ✅ Only create mode is supported (edit is disabled)
      if (mode === "edit") {
        throw new Error("Editing is disabled. Please delete and recreate the task.");
      }
      const vehicleItemContext = await optimisticCreateVehicleItem(queryClient, optimisticVehicleItem);
      
      // ⚡ INSTANT CALENDAR UPDATE: Add to calendar grid immediately
      await cancelCalendarQueries(queryClient);
      const entityTypeForCalendar = isTaskAction 
        ? 'task_action_item' 
        : isTaxLegal 
        ? 'tax_legal_item' 
        : 'vehicle';
      
      addItemOptimistically(queryClient, {
        id: optimisticVehicleItem.id,
        title: data.title,
        dueDate: new Date(data.dueDate),
        category: data.category,
        status: 'pending',
        entityType: entityTypeForCalendar as any,
        vehicleId: isTaskAction || isTaxLegal ? null : vehicleId,
        vehicleName: isTaskAction || isTaxLegal ? null : vehicleName,
        isRecurring: data.isRecurring,
        recurrenceData: data.isRecurring ? data.recurrenceData : null,
      });
      
      onOpenChange(false);
      
      return { vehicleItemContext };
    },
    onError: (error, variables, context) => {
      if (context?.vehicleItemContext) {
        rollbackVehicleItemQueries(queryClient, context.vehicleItemContext);
      }
      
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create task",
        variant: "destructive",
      });
    },
    onSuccess: (response: any) => {
      if (!isAsset) {
        // ⭐ Replace optimistic reminder schedules with real data
        // Find the temp item in optimistic data
        const vehicleItems = queryClient.getQueryData(['/api/vehicle-items']) as any[];
        const tempItem = vehicleItems?.find((item: any) => item.id.startsWith('temp-'));
        
        if (tempItem && response?.id) {
          // Import the replace function
          import('@/lib/optimistic-updates').then(({ replaceOptimisticReminderSchedules }) => {
            replaceOptimisticReminderSchedules(
              queryClient,
              'vehicle_item',
              tempItem.id, // temp ID
              response.id   // real ID from server
            );
          });
        }
      }
      
      if (isAsset) {
        queryClient.invalidateQueries({ queryKey: [itemsQueryKey] });
        queryClient.invalidateQueries({ queryKey: ["/api/asset-items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/assets"] }); // ✅ FIX: Invalidate parent cards list for instant badge update
      } else if (isTaskAction) {
        queryClient.invalidateQueries({ queryKey: [itemsQueryKey] });
        queryClient.invalidateQueries({ queryKey: ["/api/task-action-items"] });
        queryClient.invalidateQueries({ queryKey: ["/api/task-actions"] }); // ✅ FIX: Invalidate parent cards list for instant badge update
      } else if (isTaxLegal) {
        queryClient.invalidateQueries({ queryKey: [itemsQueryKey] });
        queryClient.invalidateQueries({ queryKey: ["/api/tax-legal-compliances"] });
      } else {
        invalidateVehicleItemQueries(queryClient);
      }
      
      // ⚡ SYNC WITH SERVER: Invalidate calendar to replace optimistic with real data
      invalidateCalendarQueries(queryClient);
      
      toast({
        title: "Success",
        description: "Task created successfully",
      });
      
      if (onSuccess) {
        onSuccess();
      }
    },
  });

  // ✅ METADATA-ONLY EDIT: Mutation for updating title, contacts, and recipients
  const updateMetadataMutation = useMutation({
    mutationFn: async () => {
      if (!vehicleItemId) {
        throw new Error("Task ID is required for metadata update");
      }

      // Normalize and validate email recipients
      const normalizedRecipients = metadataEmailRecipients
        .map(e => e.trim().toLowerCase())
        .filter(e => e.length > 0);
      
      // Remove duplicates
      const uniqueRecipients = Array.from(new Set(normalizedRecipients));

      // ✅ Validate and sanitize contacts
      const { sanitizedContacts, errors: contactErrors } = sanitizeContacts(metadataContacts);
      
      // Block submit if there are validation errors
      if (Object.keys(contactErrors).length > 0) {
        setMetadataContactErrors(contactErrors);
        toast({
          title: "Invalid Contact Data",
          description: "Please fix mobile number errors before updating.",
          variant: "destructive",
        });
        return;
      }

      // ✅ Build payload - only include contacts if modified OR if there are valid contacts
      const payload: any = {
        title: metadataTitle.trim(),
      };
      
      // ✅ Only include recipients if NOT locked (defensive: backend enforces this too)
      if (!shouldLockEmailRecipients) {
        payload.recipients = uniqueRecipients;
      }
      
      // ✅ Only include contacts if user modified them (dirty flag OR has valid contacts)
      if (metadataContactsDirty || sanitizedContacts.length > 0) {
        payload.contacts = sanitizedContacts;
      }

      const endpoint = isAsset
        ? `/api/assets/${vehicleId}/tasks/${vehicleItemId}/metadata`
        : isTaskAction
        ? `/api/task-actions/${vehicleId}/tasks/${vehicleItemId}/metadata`
        : isTaxLegal
        ? `/api/tax-legal-compliances/${vehicleId}/items/${vehicleItemId}/metadata`
        : `/api/vehicle-items/${vehicleItemId}/metadata`;

      return apiRequest('PATCH', endpoint, payload);
    },
    onSuccess: (data: any) => {
      const updatedRemindersCount = data?.updatedRemindersCount ?? 0;
      const updatedTask = data?.updatedTask;
      
      // ✅ Extract editability status from backend response
      setEligibleUpcomingUnsentCount(data?.eligibleUpcomingUnsentCount ?? 0);
      setFutureGenerationPossible(data?.futureGenerationPossible ?? false);
      setShouldLockEmailRecipients(data?.shouldLockEmailRecipients ?? false);
      
      // ✅ CRITICAL: Update cache immediately to prevent stale data on reopen
      if (updatedTask && vehicleItemId) {
        queryClient.setQueryData([itemsQueryKey], (oldData: any) => {
          if (!oldData || !Array.isArray(oldData)) return oldData;
          return oldData.map((item: any) => 
            item.id === vehicleItemId 
              ? { 
                  ...item, 
                  title: updatedTask.title,
                  emailRecipients: updatedTask.emailRecipients,
                  customFields: updatedTask.customFields,
                }
              : item
          );
        });
        console.log(`✅ Updated cache for task ${vehicleItemId} in ${itemsQueryKey}`);
      }
      
      // Show appropriate message based on affected reminders count
      if (updatedRemindersCount === 0) {
        toast({
          title: "Updated",
          description: "Task metadata updated. No upcoming unsent reminders to update. Changes will apply to future reminders only.",
        });
      } else {
        toast({
          title: "Updated",
          description: `Task metadata updated successfully. Updates applied to ${updatedRemindersCount} upcoming pending reminder${updatedRemindersCount > 1 ? 's' : ''}.`,
        });
      }
      
      // Invalidate relevant queries (backup - ensures refetch if needed)
      queryClient.invalidateQueries({ queryKey: [itemsQueryKey] });
      
      if (isTaxLegal) {
        queryClient.invalidateQueries({ queryKey: ["/api/tax-legal-compliances"] });
      } else if (isAsset) {
        queryClient.invalidateQueries({ queryKey: ["/api/asset-items"] });
      } else if (isTaskAction) {
        queryClient.invalidateQueries({ queryKey: ["/api/task-action-items"] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/vehicle-items"] });
      }
      
      // ✅ CRITICAL: Invalidate occurrence details query so reminder modal updates immediately
      if (vehicleItemId && entityTypeForReminders) {
        queryClient.invalidateQueries({ 
          queryKey: [`/api/task-occurrences/entity/${entityTypeForReminders}/${vehicleItemId}`] 
        });
        console.log(`✅ Invalidated occurrence details for ${entityTypeForReminders}:${vehicleItemId}`);
      }
      
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update task metadata",
        variant: "destructive",
      });
    },
  });

  const handleMetadataSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate title
    if (!metadataTitle.trim()) {
      toast({
        title: "Validation Error",
        description: "Task name is required",
        variant: "destructive",
      });
      return;
    }

    // ✅ Validate email recipients ONLY if not locked
    if (!shouldLockEmailRecipients) {
      if (metadataEmailRecipients.length === 0) {
        toast({
          title: "Validation Error",
          description: "At least one email recipient is required",
          variant: "destructive",
        });
        return;
      }

      // Warn about uncommitted email input
      if (metadataEmailInput.trim()) {
        toast({
          title: "Uncommitted Email",
          description: "You have typed an email but haven't added it. Press Enter or click + to add it.",
          variant: "destructive",
        });
        return;
      }
    }

    updateMetadataMutation.mutate();
  };

  // ✅ Submit handlers with email validation
  const handleOneTimeSubmit = (data: VehicleTaskForm) => {
    // Prevent submission in edit mode
    if (isEditMode) {
      toast({
        title: "Editing is Disabled",
        description: "Please delete and recreate the task to make changes.",
        variant: "destructive",
      });
      return;
    }
    
    // ✅ Validate contacts before submission
    const { errors: contactErrors } = sanitizeContacts(oneTimeContacts);
    if (Object.keys(contactErrors).length > 0) {
      setOneTimeContactErrors(contactErrors);
      toast({
        title: "Invalid Contact Data",
        description: "Please fix mobile number errors before creating the task.",
        variant: "destructive",
      });
      return;
    }
    
    // Validate that email recipients are committed (not just typed)
    if (oneTimeEmailRecipients.length === 0) {
      toast({
        title: "Email Recipients Required",
        description: "Please add at least one email recipient by pressing Enter or clicking the + button",
        variant: "destructive",
      });
      return;
    }
    
    // Warn if there's uncommitted text in the input
    if (oneTimeEmailInput.trim()) {
      toast({
        title: "Uncommitted Email",
        description: "You have typed an email but haven't added it. Press Enter or click + to add it.",
        variant: "destructive",
      });
      return;
    }
    
    const taskTime = data.reminderTimes?.[0] ?? "09:00";
    const dueDateIso = combineDateAndTimeToIso(data.dueDate, taskTime);
    const payload: VehicleTaskForm = {
      ...data,
      dueDate: dueDateIso ?? data.dueDate,
      reminderDays: toLegacyReminderDays(data.reminderOffsetValue, data.reminderOffsetUnit),
      isRecurring: false,
    };
    createMutation.mutate({ ...payload, _emailRecipients: oneTimeEmailRecipients });
  };

  const handleRecurringSubmit = (data: VehicleTaskForm) => {
    // Prevent submission in edit mode
    if (isEditMode) {
      toast({
        title: "Editing is Disabled",
        description: "Please delete and recreate the task to make changes.",
        variant: "destructive",
      });
      return;
    }
    
    // ✅ Validate contacts before submission
    const { errors: contactErrors } = sanitizeContacts(recurringContacts);
    if (Object.keys(contactErrors).length > 0) {
      setRecurringContactErrors(contactErrors);
      toast({
        title: "Invalid Contact Data",
        description: "Please fix mobile number errors before creating the task.",
        variant: "destructive",
      });
      return;
    }
    
    // Validate that email recipients are committed (not just typed)
    if (recurringEmailRecipients.length === 0) {
      toast({
        title: "Email Recipients Required",
        description: "Please add at least one email recipient by pressing Enter or clicking the + button",
        variant: "destructive",
      });
      return;
    }
    
    // Warn if there's uncommitted text in the input
    if (recurringEmailInput.trim()) {
      toast({
        title: "Uncommitted Email",
        description: "You have typed an email but haven't added it. Press Enter or click + to add it.",
        variant: "destructive",
      });
      return;
    }
    
    const firstOccurrenceTime = data.reminderTimes?.[0] ?? "09:00";
    const firstPreviewIso = previewOccurrences[0];
    const startDateForSave =
      (firstPreviewIso && new Date(firstPreviewIso).toISOString()) ||
      combineDateAndTimeToIso(data.dueDate, firstOccurrenceTime) ||
      data.dueDate;
    const anchorDateOnly =
      startDateForSave?.includes("T") ? startDateForSave.split("T")[0] : startDateForSave;
    const dueDateIso =
      combineDateAndTimeToIso(anchorDateOnly || data.dueDate, firstOccurrenceTime) ||
      anchorDateOnly ||
      data.dueDate;
    const sanitizedRecurrence = data.recurrenceData
      ? sanitizeRecurrenceForSave(
          { ...data.recurrenceData, startDate: startDateForSave },
          new Date(startDateForSave ?? data.dueDate)
        ) ?? null
      : null;

    const parsed = recurrenceDataSchema.safeParse(sanitizedRecurrence);
    if (!parsed.success) {
      toast({
        title: "Invalid recurrence",
        description: parsed.error?.issues?.[0]?.message ?? "Please review recurrence fields.",
        variant: "destructive",
      });
      return;
    }

    const payload: VehicleTaskForm = {
      ...data,
      dueDate: dueDateIso ?? data.dueDate,
      emailRecipients: recurringEmailRecipients,
      reminderDays: toLegacyReminderDays(data.reminderOffsetValue, data.reminderOffsetUnit),
      isRecurring: true,
      recurrenceData: parsed.data as any,
    };
    
    createMutation.mutate({ ...payload, _emailRecipients: recurringEmailRecipients });
  };

  // ✅ Email management (DRY) with strict validation
  const addEmail = (input: string, currentList: string[], setList: (list: string[]) => void, setInput: (val: string) => void) => {
    const email = input.trim();
    
    if (!email) {
      return;
    }
    
    // Strict email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    
    // Check for duplicates
    if (currentList.includes(email)) {
      toast({
        title: "Duplicate Email",
        description: "This email has already been added",
        variant: "destructive",
      });
      return;
    }
    
    setList([...currentList, email]);
    setInput("");
  };

  const removeEmail = (email: string, currentList: string[], setList: (list: string[]) => void) => {
    setList(currentList.filter(e => e !== email));
  };

  const renderOneTimeEditView = () => {
    const summary = buildOneTimeScheduleSummary({
      dueDate: oneTimeDueDateValue,
      occurrenceTime: oneTimeReminderTimesValue?.[0],
      reminderTime: oneTimeReminderTimesValue?.[1],
      reminderOffsetValue: oneTimeOffsetValue,
      reminderOffsetUnit: oneTimeOffsetUnit as ReminderOffsetUnit | null,
    });

    return (
      <div className="rounded-lg p-6 space-y-6 border border-gray-200">
        {oneTimeCompleted && (
          <div className="p-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-700">
            This one-time task is completed. Fields are read-only.
          </div>
        )}
        {!oneTimeCompleted && oneTimeReminderSent && (
          <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-900">
            Reminder already sent. Date/time, reminder settings, channels, and recipients can&apos;t be changed.
          </div>
        )}

        {oneTimeUiState.showScheduleSummary && (
          <div className="rounded-md border border-muted-foreground/20 bg-muted/20 p-4 space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Schedule</p>
            <p className="text-sm text-muted-foreground">{summary.taskLine}</p>
            <p className="text-sm text-muted-foreground">{summary.reminderLine}</p>
          </div>
        )}

        <Form {...oneTimeForm}>
          <form
            onSubmit={oneTimeForm.handleSubmit(handleOneTimeSubmit)}
            className="space-y-4"
          >
            <FormField
              control={oneTimeForm.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Insurance Renewal" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={oneTimeForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional notes..." rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-4 border-t">
              <h4 className="font-medium mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Notification & Recipients
              </h4>

              <FormField
                control={oneTimeForm.control}
                name="notificationChannels"
                render={({ field }) => (
                  <FormItem className="mb-4">
                    <FormLabel>Notification Channels</FormLabel>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={field.value.includes('email')}
                          onCheckedChange={(checked) => {
                            const updated = checked
                              ? [...field.value, 'email']
                              : field.value.filter((v) => v !== 'email');
                            field.onChange(updated);
                          }}
                          disabled={!canEditOneTimeStructure}
                        />
                        <label className="text-sm">Email</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={field.value.includes('whatsapp')}
                          onCheckedChange={(checked) => {
                            const updated = checked
                              ? [...field.value, 'whatsapp']
                              : field.value.filter((v) => v !== 'whatsapp');
                            field.onChange(updated);
                          }}
                          disabled={!canEditOneTimeStructure}
                        />
                        <label className="text-sm">WhatsApp</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={field.value.includes('sms')}
                          onCheckedChange={(checked) => {
                            const updated = checked
                              ? [...field.value, 'sms']
                              : field.value.filter((v) => v !== 'sms');
                            field.onChange(updated);
                          }}
                          disabled={!canEditOneTimeStructure}
                        />
                        <label className="text-sm">SMS</label>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="mb-4">
                <FormLabel className="mb-2 block">Email Recipients *</FormLabel>
                <div className="flex gap-2 mb-2">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={oneTimeEmailInput}
                    onChange={(e) => setOneTimeEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEmail(
                          oneTimeEmailInput,
                          oneTimeEmailRecipients,
                          setOneTimeEmailRecipients,
                          setOneTimeEmailInput
                        );
                      }
                    }}
                    disabled={!canEditOneTimeStructure}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() =>
                      canEditOneTimeStructure &&
                      addEmail(
                        oneTimeEmailInput,
                        oneTimeEmailRecipients,
                        setOneTimeEmailRecipients,
                        setOneTimeEmailInput
                      )
                    }
                    disabled={!canEditOneTimeStructure}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {oneTimeEmailRecipients.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {oneTimeEmailRecipients.map((email) => (
                      <Badge key={email} variant="secondary" className="gap-1">
                        {email}
                        <X
                          className={cn(
                            "w-3 h-3 cursor-pointer",
                            !canEditOneTimeStructure && "opacity-50 cursor-not-allowed"
                          )}
                          onClick={() => {
                            if (!canEditOneTimeStructure) return;
                            removeEmail(
                              email,
                              oneTimeEmailRecipients,
                              setOneTimeEmailRecipients
                            );
                          }}
                        />
                      </Badge>
                    ))}
                  </div>
                )}
                <FormDescription className="text-xs">
                  Press Enter or click the + button to add one or more email addresses
                </FormDescription>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={createMutation.isPending || oneTimeCompleted}
            >
              {createMutation.isPending ? "Saving..." : "Update Task"}
            </Button>
          </form>
        </Form>
      </div>
    );
  };

  const renderRecurringLimitedForm = (options?: { showLockNotice?: boolean }) => (
    <div className="rounded-lg p-6 space-y-6 border border-gray-200">
      {options?.showLockNotice && (
        <div className="p-3 bg-muted rounded-lg border border-muted-foreground/20 text-sm text-muted-foreground flex items-center gap-2">
          <Repeat className="w-4 h-4" />
          Recurring schedule locked. Only task info, channels, and recipients can be edited.
        </div>
      )}

      <Form {...recurringForm}>
        <form onSubmit={recurringForm.handleSubmit(handleRecurringSubmit)} className="space-y-4">
          <FormField
            control={recurringForm.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Task Name *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g., Monthly Service Check" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={recurringForm.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Task Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea {...field} placeholder="Additional notes..." rows={2} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="pt-4 border-t">
            <h4 className="font-medium mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Notification & Recipients
            </h4>

            <FormField
              control={recurringForm.control}
              name="notificationChannels"
              render={({ field }) => (
                <FormItem className="mb-4">
                  <FormLabel>Notification Channels</FormLabel>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={field.value.includes('email')}
                        onCheckedChange={(checked) => {
                          const updated = checked
                            ? [...field.value, 'email']
                            : field.value.filter((v) => v !== 'email');
                          field.onChange(updated);
                        }}
                      />
                      <label className="text-sm">Email</label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={field.value.includes('whatsapp')}
                        onCheckedChange={(checked) => {
                          const updated = checked
                            ? [...field.value, 'whatsapp']
                            : field.value.filter((v) => v !== 'whatsapp');
                          field.onChange(updated);
                        }}
                      />
                      <label className="text-sm">WhatsApp</label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        checked={field.value.includes('sms')}
                        onCheckedChange={(checked) => {
                          const updated = checked
                            ? [...field.value, 'sms']
                            : field.value.filter((v) => v !== 'sms');
                          field.onChange(updated);
                        }}
                      />
                      <label className="text-sm">SMS</label>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="mb-4">
              <FormLabel className="mb-2 block">Email Recipients *</FormLabel>
              <div className="flex gap-2 mb-2">
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={recurringEmailInput}
                  onChange={(e) => setRecurringEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addEmail(
                        recurringEmailInput,
                        recurringEmailRecipients,
                        setRecurringEmailRecipients,
                        setRecurringEmailInput
                      );
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() =>
                    addEmail(
                      recurringEmailInput,
                      recurringEmailRecipients,
                      setRecurringEmailRecipients,
                      setRecurringEmailInput
                    )
                  }
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {recurringEmailRecipients.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {recurringEmailRecipients.map((email) => (
                    <Badge key={email} variant="secondary" className="gap-1">
                      {email}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() =>
                          removeEmail(
                            email,
                            recurringEmailRecipients,
                            setRecurringEmailRecipients
                          )
                        }
                      />
                    </Badge>
                  ))}
                </div>
              )}
              <FormDescription className="text-xs">
                Press Enter or click the + button to add one or more email addresses
              </FormDescription>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving..." : "Update Task"}
          </Button>
        </form>
      </Form>
    </div>
  );

  const renderRecurringEditView = () => {
    if (shouldLimitRecurringEdit) {
      return renderRecurringLimitedForm({ showLockNotice: true });
    }

    return (
      <div className="rounded-lg p-6 space-y-6 border border-gray-200">
        <Form {...recurringForm}>
          <form onSubmit={recurringForm.handleSubmit(handleRecurringSubmit)} className="space-y-4">
            <FormField
              control={recurringForm.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Monthly Service Check" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={recurringForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Task Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Additional notes..." rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-4 border-t">
              <h4 className="font-medium mb-4 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Notification & Recipients
              </h4>

              <FormField
                control={recurringForm.control}
                name="notificationChannels"
                render={({ field }) => (
                  <FormItem className="mb-4">
                    <FormLabel>Notification Channels</FormLabel>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={field.value.includes('email')}
                          onCheckedChange={(checked) => {
                            const updated = checked
                              ? [...field.value, 'email']
                              : field.value.filter((v) => v !== 'email');
                            field.onChange(updated);
                          }}
                        />
                        <label className="text-sm">Email</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={field.value.includes('whatsapp')}
                          onCheckedChange={(checked) => {
                            const updated = checked
                              ? [...field.value, 'whatsapp']
                              : field.value.filter((v) => v !== 'whatsapp');
                            field.onChange(updated);
                          }}
                        />
                        <label className="text-sm">WhatsApp</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          checked={field.value.includes('sms')}
                          onCheckedChange={(checked) => {
                            const updated = checked
                              ? [...field.value, 'sms']
                              : field.value.filter((v) => v !== 'sms');
                            field.onChange(updated);
                          }}
                        />
                        <label className="text-sm">SMS</label>
                      </div>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="mb-4">
                <FormLabel className="mb-2 block">Email Recipients *</FormLabel>
                <div className="flex gap-2 mb-2">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={recurringEmailInput}
                    onChange={(e) => setRecurringEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addEmail(
                          recurringEmailInput,
                          recurringEmailRecipients,
                          setRecurringEmailRecipients,
                          setRecurringEmailInput
                        );
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() =>
                      addEmail(
                        recurringEmailInput,
                        recurringEmailRecipients,
                        setRecurringEmailRecipients,
                        setRecurringEmailInput
                      )
                    }
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                {recurringEmailRecipients.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {recurringEmailRecipients.map((email) => (
                      <Badge key={email} variant="secondary" className="gap-1">
                        {email}
                        <X
                          className="w-3 h-3 cursor-pointer"
                          onClick={() =>
                            removeEmail(
                              email,
                              recurringEmailRecipients,
                              setRecurringEmailRecipients
                            )
                          }
                        />
                      </Badge>
                    ))}
                  </div>
                )}
                <FormDescription className="text-xs">
                  Press Enter or click the + button to add one or more email addresses
                </FormDescription>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Updating..." : "Update Task"}
            </Button>
          </form>
        </Form>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? `Add Task for ${vehicleName}`
              : `Edit Task – ${vehicleName}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create" 
              ? "Choose between a one-time task or a recurring task"
              : "Update task details and reminder settings"}
          </DialogDescription>
        </DialogHeader>

        {/* ✅ MODE SWITCH (CREATE ONLY) */}
        {!isEditMode && (
          <div className="flex gap-2 p-1 bg-muted rounded-lg">
            <Button
              type="button"
              variant={taskType === 'one-time' ? 'default' : 'ghost'}
              className="flex-1"
              onClick={() => handleTaskTypeSelect('one-time')}
              disabled={disableOneTimeTab}
            >
              <Clock className="w-4 h-4 mr-2" />
              One-Time Task
            </Button>
            <Button
              type="button"
              variant={taskType === 'recurring' ? 'default' : 'ghost'}
              className="flex-1"
              onClick={() => handleTaskTypeSelect('recurring')}
              disabled={disableRecurringTab}
            >
              <Repeat className="w-4 h-4 mr-2" />
              Recurring Task
            </Button>
          </div>
        )}

        {/* ✅ CONDITIONAL RENDERING */}
        {!isEditMode && (
        <div className="mt-4">
          
          {/* ==================== ONE-TIME SECTION ==================== */}
          {taskType === 'one-time' && (
            <div className="rounded-lg p-6 space-y-6 border border-gray-200">
              <Form {...oneTimeForm}>
                <form onSubmit={oneTimeForm.handleSubmit(handleOneTimeSubmit)} className="space-y-4">
                {oneTimeCompleted && (
                  <div className="p-3 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-700">
                    This one-time task is completed. Fields are read-only.
                  </div>
                )}
                {!oneTimeCompleted && oneTimeReminderSent && (
                  <div className="p-3 rounded-md border border-amber-200 bg-amber-50 text-sm text-amber-900">
                    Reminder already sent. Date/time, reminder settings, channels, and recipients can&apos;t be changed.
                  </div>
                )}
                
                {/* Task Name */}
                <FormField
                  control={oneTimeForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Insurance Renewal" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Date and Time (side by side) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Date */}
                <FormField
                  control={oneTimeForm.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                        <FormLabel>Date *</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          {...field}
                          disabled={!canEditOneTimeStructure}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                  {/* Time */}
                  <FormField
                    control={oneTimeForm.control}
                    name="reminderTimes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Time *</FormLabel>
                        <FormControl>
                          <TimePicker12H
                            value={field.value[0] || '09:00'}
                            onChange={(value) => field.onChange([value])}
                            disabled={!canEditOneTimeStructure}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Task Notes */}
                <FormField
                  control={oneTimeForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Additional notes..." rows={2} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Contacts (Optional) */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium">Contacts (Optional)</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addOneTimeContact}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Contact
                    </Button>
                  </div>
                  
                  {oneTimeContacts.length > 0 && (
                    <div className="space-y-3">
                      {oneTimeContacts.map((contact) => (
                        <div key={contact.id} className="p-3 border rounded-lg space-y-3 bg-muted/30">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <Label className="text-xs">Name *</Label>
                              <Input
                                value={contact.name}
                                onChange={(e) => updateOneTimeContact(contact.id, 'name', e.target.value)}
                                placeholder="e.g., John Doe"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Mobile *</Label>
                              <Input
                                value={contact.mobile}
                                onChange={(e) => updateOneTimeContact(contact.id, 'mobile', e.target.value)}
                                onBlur={() => validateOneTimeContactMobile(contact.id)}
                                placeholder="e.g., +91 9876543210"
                                className={cn("mt-1", oneTimeContactErrors[contact.id] && "border-destructive")}
                              />
                              {oneTimeContactErrors[contact.id] && (
                                <p className="text-xs text-destructive mt-1">
                                  {oneTimeContactErrors[contact.id]}
                                </p>
                              )}
                            </div>
                            <div>
                              <Label className="text-xs">Designation</Label>
                              <Input
                                value={contact.designation}
                                onChange={(e) => updateOneTimeContact(contact.id, 'designation', e.target.value)}
                                placeholder="e.g., Manager"
                                className="mt-1"
                              />
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeOneTimeContact(contact.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Reminder Settings */}
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Reminder Settings
                  </h4>

                  <ReminderOffsetFields
                    formInstance={oneTimeForm}
                    disabled={!canEditOneTimeStructure}
                  />

                  {isOneTimeDayOffset ? (
                    <FormField
                      control={oneTimeForm.control}
                      name="reminderTimes"
                      render={({ field }) => (
                        <FormItem className="mb-4">
                          <FormLabel>Reminder Time</FormLabel>
                          <FormControl>
                            <TimePicker12H
                              value={field.value[1] || field.value[0] || '09:00'}
                              onChange={(value) => {
                                const newValue = [field.value[0] || '09:00', value];
                                field.onChange(newValue);
                              }}
                              disabled={!canEditOneTimeStructure}
                            />
                          </FormControl>
                          <FormDescription className="text-xs">
                            On each reminder day, send at this time.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground mb-4">
                      We'll send the reminder exactly {formatOffsetSummary(oneTimeOffsetValue, oneTimeOffsetUnit)} before the task's
                      scheduled time.
                    </p>
                  )}

                  {/* Notification Channels */}
                  <FormField
                    control={oneTimeForm.control}
                    name="notificationChannels"
                    render={({ field }) => (
                      <FormItem className="mb-4">
                        <FormLabel>Notification Channels</FormLabel>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={field.value.includes('email')}
                              onCheckedChange={(checked) => {
                                const updated = checked
                                  ? [...field.value, 'email']
                                  : field.value.filter(v => v !== 'email');
                                field.onChange(updated);
                              }}
                              disabled={!canEditOneTimeStructure}
                            />
                            <label className="text-sm">Email</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={field.value.includes('whatsapp')}
                              onCheckedChange={(checked) => {
                                const updated = checked
                                  ? [...field.value, 'whatsapp']
                                  : field.value.filter(v => v !== 'whatsapp');
                                field.onChange(updated);
                              }}
                              disabled={!canEditOneTimeStructure}
                            />
                            <label className="text-sm">WhatsApp</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={field.value.includes('sms')}
                              onCheckedChange={(checked) => {
                                const updated = checked
                                  ? [...field.value, 'sms']
                                  : field.value.filter(v => v !== 'sms');
                                field.onChange(updated);
                              }}
                              disabled={!canEditOneTimeStructure}
                            />
                            <label className="text-sm">SMS</label>
                          </div>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Email Recipients */}
                  <div className="mb-4">
                    <FormLabel className="mb-2 block">Email Recipients *</FormLabel>
                    <div className="flex gap-2 mb-2">
                      <Input
                        type="email"
                        placeholder="email@example.com"
                        value={oneTimeEmailInput}
                        onChange={(e) => setOneTimeEmailInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addEmail(oneTimeEmailInput, oneTimeEmailRecipients, setOneTimeEmailRecipients, setOneTimeEmailInput);
                          }
                        }}
                        disabled={!canEditOneTimeStructure}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => canEditOneTimeStructure && addEmail(oneTimeEmailInput, oneTimeEmailRecipients, setOneTimeEmailRecipients, setOneTimeEmailInput)}
                        disabled={!canEditOneTimeStructure}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {oneTimeEmailRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {oneTimeEmailRecipients.map((email) => (
                          <Badge key={email} variant="secondary" className="gap-1">
                            {email}
                            <X
                              className={cn(
                                "w-3 h-3 cursor-pointer",
                                !canEditOneTimeStructure && "opacity-50 cursor-not-allowed"
                              )}
                              onClick={() => {
                                if (!canEditOneTimeStructure) return;
                                removeEmail(
                                  email,
                                  oneTimeEmailRecipients,
                                  setOneTimeEmailRecipients
                                );
                              }}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <FormDescription className="text-xs">
                      Press Enter or click the + button to add one or more email addresses
                    </FormDescription>
                  </div>
                </div>

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={createMutation.isPending || oneTimeCompleted}
                  >
                    {createMutation.isPending
                      ? mode === "create"
                        ? "Creating..."
                        : "Saving..."
                      : mode === "create"
                      ? "Create One-Time Task"
                      : "Save Changes"}
                  </Button>
                </form>
              </Form>
            </div>
          )}

          {/* ==================== RECURRING SECTION ==================== */}
          {taskType === 'recurring' && (
            <div className="rounded-lg p-6 space-y-6 border border-gray-200">
              <Form {...recurringForm}>
                <form
                  onSubmit={recurringForm.handleSubmit(handleRecurringSubmit)}
                  className="space-y-4"
                >
                
                {/* Task Name */}
                <FormField
                  control={recurringForm.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Monthly Service Check" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Start Date and Occurrence Time (side by side) */}
                {!shouldLimitRecurringEdit && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Start Date */}
                  <FormField
                    control={recurringForm.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                          <FormLabel>Start Date *</FormLabel>
                        <FormControl>
                        <Input type="date" {...field} disabled={startDateDisabled} />
                        </FormControl>
                        <FormDescription className="text-xs text-muted-foreground">
                          Start date will snap to the first valid occurrence when you save.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                    {/* Time */}
                    <FormField
                      control={recurringForm.control}
                      name="reminderTimes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Time *</FormLabel>
                          <FormControl>
                            <TimePicker12H
                              value={field.value[0] || '09:00'}
                              onChange={(value) => {
                                const newValue = [value];
                                if (field.value && field.value.length > 1) {
                                  newValue.push(field.value[1]);
                                }
                                field.onChange(newValue);
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Task Notes */}
                <FormField
                  control={recurringForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Additional notes..." rows={2} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Contacts (Optional) */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium">Contacts (Optional)</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addRecurringContact}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Contact
                    </Button>
                  </div>
                  
                  {recurringContacts.length > 0 && (
                    <div className="space-y-3">
                      {recurringContacts.map((contact) => (
                        <div key={contact.id} className="p-3 border rounded-lg space-y-3 bg-muted/30">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <Label className="text-xs">Name *</Label>
                              <Input
                                value={contact.name}
                                onChange={(e) => updateRecurringContact(contact.id, 'name', e.target.value)}
                                placeholder="e.g., John Doe"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Mobile *</Label>
                              <Input
                                value={contact.mobile}
                                onChange={(e) => updateRecurringContact(contact.id, 'mobile', e.target.value)}
                                onBlur={() => validateRecurringContactMobile(contact.id)}
                                placeholder="e.g., +91 9876543210"
                                className={cn("mt-1", recurringContactErrors[contact.id] && "border-destructive")}
                              />
                              {recurringContactErrors[contact.id] && (
                                <p className="text-xs text-destructive mt-1">
                                  {recurringContactErrors[contact.id]}
                                </p>
                              )}
                            </div>
                            <div>
                              <Label className="text-xs">Designation</Label>
                              <Input
                                value={contact.designation}
                                onChange={(e) => updateRecurringContact(contact.id, 'designation', e.target.value)}
                                placeholder="e.g., Manager"
                                className="mt-1"
                              />
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRecurringContact(contact.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recurrence Settings */}
                {!shouldLimitRecurringEdit && (
                  <div className="pt-4 border-t">
                    <h4 className="font-medium mb-4 flex items-center gap-2">
                      <Repeat className="w-4 h-4" />
                      Recurrence Settings
                    </h4>

                    <FormField
                      control={recurringForm.control}
                      name="recurrenceData"
                      render={({ field }) => {
                        const startDateValue = recurringDueDateValue;
                        const startDate = startDateValue ? new Date(startDateValue) : new Date();
                        const defaultWeekday = startDate.getDay();
                        const defaultMonthDay = startDate.getDate();

                        const recurrenceValue = {
                          pattern: field.value?.pattern || 'daily',
                          interval: field.value?.interval || 1,
                          endType: field.value?.endType || 'never',
                          endCount: field.value?.endCount,
                          weekDays: field.value?.weekDays || [defaultWeekday],
                          monthlyType: field.value?.monthlyType || 'date',
                          monthlyDate: field.value?.monthlyDate || defaultMonthDay,
                          monthlyOrdinal: asMonthlyOrdinal(field.value?.monthlyOrdinal, 'first'),
                          monthlyWeekday:
                            typeof field.value?.monthlyWeekday === 'number'
                              ? field.value?.monthlyWeekday
                              : defaultWeekday,
                        };

                        type RecurrenceFrequency = 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly';
                        const getFrequencyFromPattern = (pattern?: string): RecurrenceFrequency => {
                          if (pattern === 'weekly') return 'weekly';
                          if (pattern === 'monthly') return 'monthly';
                          if (pattern === 'hourly') return 'hourly';
                          if (pattern === 'minutely') return 'minutely';
                          return 'daily';
                        };
                        const frequency = getFrequencyFromPattern(recurrenceValue.pattern);

                        const setRecurrenceValue = (updates: Partial<typeof recurrenceValue>) => {
                          field.onChange({ ...recurrenceValue, ...updates });
                        };

                        const handleFrequencyChange = (nextFrequency: RecurrenceFrequency) => {
                          if (nextFrequency === 'minutely') {
                            setRecurrenceValue({
                              pattern: 'minutely',
                            });
                            return;
                          }
                          if (nextFrequency === 'hourly') {
                            setRecurrenceValue({
                              pattern: 'hourly',
                            });
                            return;
                          }
                          if (nextFrequency === 'daily') {
                            setRecurrenceValue({
                              pattern: 'daily',
                            });
                          } else if (nextFrequency === 'weekly') {
                            setRecurrenceValue({
                              pattern: 'weekly',
                              weekDays:
                                recurrenceValue.weekDays && recurrenceValue.weekDays.length > 0
                                  ? recurrenceValue.weekDays
                                  : [defaultWeekday],
                            });
                          } else if (nextFrequency === 'monthly') {
                            setRecurrenceValue({
                              pattern: 'monthly',
                              monthlyType: recurrenceValue.monthlyType || 'date',
                              monthlyDate: recurrenceValue.monthlyDate || defaultMonthDay,
                              monthlyOrdinal: asMonthlyOrdinal(recurrenceValue.monthlyOrdinal, 'first'),
                              monthlyWeekday: recurrenceValue.monthlyWeekday ?? defaultWeekday,
                            });
                          }
                        };

                        const weekdayOptions = [
                          { value: 0, label: 'Sun', full: 'Sunday' },
                          { value: 1, label: 'Mon', full: 'Monday' },
                          { value: 2, label: 'Tue', full: 'Tuesday' },
                          { value: 3, label: 'Wed', full: 'Wednesday' },
                          { value: 4, label: 'Thu', full: 'Thursday' },
                          { value: 5, label: 'Fri', full: 'Friday' },
                          { value: 6, label: 'Sat', full: 'Saturday' },
                        ];

                        const ordinalOptions: { value: string; label: string }[] = [
                          { value: 'first', label: 'First' },
                          { value: 'second', label: 'Second' },
                          { value: 'third', label: 'Third' },
                          { value: 'fourth', label: 'Fourth' },
                          { value: 'last', label: 'Last' },
                        ];

                        const monthlyMode = recurrenceValue.monthlyType === 'date' ? 'dayOfMonth' : 'nthWeekday';
                        const intervalLabel = (() => {
                          switch (frequency) {
                            case 'minutely':
                              return 'minute(s)';
                            case 'hourly':
                              return 'hour(s)';
                            case 'weekly':
                              return 'week(s)';
                            case 'monthly':
                              return 'month(s)';
                            default:
                              return 'day(s)';
                          }
                        })();

                        const previewStartDate = previewStartDateValue;
                        const occurrenceTime = previewOccurrenceTime;

                        if (import.meta.env.DEV && frequency === 'weekly') {
                          console.debug('[Recurrence debug] weekly recurrenceData', {
                            pattern: recurrenceValue.pattern,
                            interval: recurrenceValue.interval,
                            weekDays: recurrenceValue.weekDays,
                            dueDate: previewStartDate,
                          });
                        }

                        return (
                          <FormItem className="space-y-4">
                            <div className="space-y-2">
                              <FormLabel>Repeats</FormLabel>
                              <Select value={frequency} onValueChange={(value: RecurrenceFrequency) => handleFrequencyChange(value)}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="minutely">Minute (testing)</SelectItem>
                                  <SelectItem value="hourly">Hour (testing)</SelectItem>
                                  <SelectItem value="daily">Day</SelectItem>
                                  <SelectItem value="weekly">Week</SelectItem>
                                  <SelectItem value="monthly">Month</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <FormLabel>Repeats every</FormLabel>
                              <div className="flex gap-2 items-center">
                                <Input
                                  type="number"
                                  min="1"
                                  className="w-full sm:w-20"
                                  value={recurrenceValue.interval}
                                  onChange={(e) =>
                                    setRecurrenceValue({
                                      interval: Math.max(1, parseInt(e.target.value) || 1),
                                    })
                                  }
                                />
                                <div className="text-sm text-muted-foreground">{intervalLabel}</div>
                              </div>
                            </div>

                            {frequency === 'weekly' && (
                              <div className="space-y-2">
                                <FormLabel>Select weekdays</FormLabel>
                                <div className="flex flex-wrap gap-2">
                                  {weekdayOptions.map((day) => {
                                    const isSelected = recurrenceValue.weekDays?.includes(day.value);
                                    return (
                                      <Button
                                        key={day.value}
                                        type="button"
                                        variant={isSelected ? "default" : "outline"}
                                        size="sm"
                                        className="w-14 min-h-[44px]"
                                        onClick={() => {
                                          const current = new Set(recurrenceValue.weekDays || []);
                                          if (isSelected) {
                                            current.delete(day.value);
                                          } else {
                                            current.add(day.value);
                                          }
                                          setRecurrenceValue({ weekDays: Array.from(current).sort((a, b) => a - b) });
                                        }}
                                      >
                                        {day.label}
                                      </Button>
                                    );
                                  })}
                                </div>
                                {(recurrenceValue.weekDays?.length || 0) === 0 && (
                                  <p className="text-xs text-destructive">Select at least one weekday.</p>
                                )}
                              </div>
                            )}

                            {frequency === 'monthly' && (
                              <div className="space-y-3">
                                <FormLabel>Monthly pattern</FormLabel>
                                <RadioGroup
                                  value={monthlyMode}
                                  onValueChange={(mode) => {
                                    if (mode === 'dayOfMonth') {
                                      setRecurrenceValue({
                                        monthlyType: 'date',
                                        monthlyDate: recurrenceValue.monthlyDate || defaultMonthDay,
                                      });
                                    } else {
                                      setRecurrenceValue({
                                        monthlyType: 'day',
                                        monthlyOrdinal: asMonthlyOrdinal(recurrenceValue.monthlyOrdinal, 'first'),
                                        monthlyWeekday:
                                          typeof recurrenceValue.monthlyWeekday === 'number'
                                            ? recurrenceValue.monthlyWeekday
                                            : defaultWeekday,
                                      });
                                    }
                                  }}
                                  className="space-y-3"
                                >
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="dayOfMonth" id="monthly-day" />
                                    <Label htmlFor="monthly-day" className="flex items-center space-x-2">
                                      <span>On day</span>
                                      <Input
                                        type="number"
                                        min="1"
                                        max="31"
                                        className="w-16"
                                        value={recurrenceValue.monthlyDate}
                                        onChange={(e) =>
                                          setRecurrenceValue({
                                            monthlyType: 'date',
                                            monthlyDate: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)),
                                          })
                                        }
                                      />
                                    </Label>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <RadioGroupItem value="nthWeekday" id="monthly-ordinal" />
                                    <Label htmlFor="monthly-ordinal" className="flex flex-wrap items-center gap-2">
                                      <Select
                                        value={recurrenceValue.monthlyOrdinal}
                                        onValueChange={(value) =>
                                          setRecurrenceValue({
                                            monthlyType: 'day',
                                            monthlyOrdinal: asMonthlyOrdinal(value, 'first'),
                                          })
                                        }
                                      >
                                        <SelectTrigger className="w-full sm:w-28">
                                          <SelectValue placeholder="Ordinal" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {ordinalOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                              {option.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Select
                                        value={String(recurrenceValue.monthlyWeekday)}
                                        onValueChange={(value) =>
                                          setRecurrenceValue({
                                            monthlyType: 'day',
                                            monthlyWeekday: parseInt(value),
                                          })
                                        }
                                      >
                                        <SelectTrigger className="w-full sm:w-32">
                                          <SelectValue placeholder="Weekday" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {weekdayOptions.map((day) => (
                                            <SelectItem key={day.value} value={day.value.toString()}>
                                              {day.full}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </Label>
                                  </div>
                                </RadioGroup>
                              </div>
                            )}

                            {/* Next Occurrences Preview */}
                            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-md">
                              <div className="flex items-center gap-2 mb-2">
                                <Repeat className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                  Upcoming occurrences
                                </span>
                                {recurrencePreviewLoading && (
                                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                                )}
                              </div>
                              {recurrencePreviewError ? (
                                <p className="text-xs text-red-600 dark:text-red-400">{recurrencePreviewError}</p>
                              ) : previewOccurrences.length === 0 ? (
                                <p className="text-xs text-blue-800 dark:text-blue-200">
                                  No upcoming occurrences.
                                </p>
                              ) : (
                                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                                  {previewOccurrences.map((iso, index) => (
                                    <div
                                      key={`${iso}-${index}`}
                                      className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200"
                                    >
                                      <CalendarIcon className="w-3 h-3" />
                                      <span>{formatPreviewOccurrence(iso)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </FormItem>
                        );
                      }}
                    />

                  {/* Ends */}
                  <FormField
                    control={recurringForm.control}
                    name="recurrenceData"
                    render={({ field }) => (
                      <FormItem className="mb-4">
                        <FormLabel>Ends</FormLabel>
                        <RadioGroup
                          value={field.value?.endType || 'never'}
                          onValueChange={(endType) => {
                            field.onChange({
                              ...field.value,
                              endType,
                            });
                          }}
                        >
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="never" id="rec-never" className="border-2 border-input" />
                            <label htmlFor="rec-never" className="text-sm">Never</label>
                          </div>
                          <div className="flex items-center space-x-2 gap-2">
                            <RadioGroupItem value="after" id="rec-after" className="border-2 border-input" />
                            <label htmlFor="rec-after" className="text-sm">After</label>
                            <Input
                              type="number"
                              min="1"
                              max="200"
                              className="w-full sm:w-20 h-10 sm:h-8"
                              value={field.value?.endCount || 10}
                              onChange={(e) => {
                                const value = parseInt(e.target.value) || 10;
                                const clamped = Math.min(Math.max(value, 1), 200);
                                field.onChange({
                                  ...field.value,
                                  endType: 'after',
                                  endCount: clamped,
                                });
                              }}
                              disabled={field.value?.endType !== 'after'}
                            />
                            <span className="text-sm">occurrences</span>
                          </div>
                        </RadioGroup>
                        <p className="text-xs text-muted-foreground mt-1">Max recurring is 200.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  </div>
                )}

                {/* Reminder Settings / Notification block */}
                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    {shouldLimitRecurringEdit ? "Notification & Recipients" : "Reminder Settings"}
                  </h4>

                  {!shouldLimitRecurringEdit && (
                    <>
                      <ReminderOffsetFields formInstance={recurringForm} />

                      {isRecurringDayOffset ? (
                        <FormField
                          control={recurringForm.control}
                          name="reminderTimes"
                          render={({ field }) => (
                            <FormItem className="mb-4">
                              <FormLabel>Reminder Time</FormLabel>
                              <FormControl>
                                <TimePicker12H
                                  value={field.value[1] || field.value[0] || '09:00'}
                                  onChange={(value) => {
                                    // Store as [occurrenceTime, reminderTime]
                                    const occurrenceTime = field.value[0] || '09:00';
                                    field.onChange([occurrenceTime, value]);
                                  }}
                                />
                              </FormControl>
                              <FormDescription className="text-xs">
                                On each reminder day, send at this time.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground mb-4">
                          We'll send the reminder exactly {formatOffsetSummary(recurringOffsetValue, recurringOffsetUnit)} before each
                          occurrence's scheduled time.
                        </p>
                      )}
                    </>
                  )}

                  {/* Notification Channels */}
                  <FormField
                    control={recurringForm.control}
                    name="notificationChannels"
                    render={({ field }) => (
                      <FormItem className="mb-4">
                        <FormLabel>Notification Channels</FormLabel>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={field.value.includes('email')}
                              onCheckedChange={(checked) => {
                                const updated = checked
                                  ? [...field.value, 'email']
                                  : field.value.filter(v => v !== 'email');
                                field.onChange(updated);
                              }}
                            />
                            <label className="text-sm">Email</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={field.value.includes('whatsapp')}
                              onCheckedChange={(checked) => {
                                const updated = checked
                                  ? [...field.value, 'whatsapp']
                                  : field.value.filter(v => v !== 'whatsapp');
                                field.onChange(updated);
                              }}
                            />
                            <label className="text-sm">WhatsApp</label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              checked={field.value.includes('sms')}
                              onCheckedChange={(checked) => {
                                const updated = checked
                                  ? [...field.value, 'sms']
                                  : field.value.filter(v => v !== 'sms');
                                field.onChange(updated);
                              }}
                            />
                            <label className="text-sm">SMS</label>
                          </div>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Email Recipients */}
                  <div className="mb-4">
                    <FormLabel className="mb-2 block">Email Recipients *</FormLabel>
                    <div className="flex gap-2 mb-2">
                      <Input
                        type="email"
                        placeholder="email@example.com"
                        value={recurringEmailInput}
                        onChange={(e) => setRecurringEmailInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addEmail(recurringEmailInput, recurringEmailRecipients, setRecurringEmailRecipients, setRecurringEmailInput);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={() => addEmail(recurringEmailInput, recurringEmailRecipients, setRecurringEmailRecipients, setRecurringEmailInput)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {recurringEmailRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {recurringEmailRecipients.map((email) => (
                          <Badge key={email} variant="secondary" className="gap-1">
                            {email}
                            <X
                              className="w-3 h-3 cursor-pointer"
                              onClick={() => removeEmail(email, recurringEmailRecipients, setRecurringEmailRecipients)}
                            />
                          </Badge>
                        ))}
                      </div>
                    )}
                    <FormDescription className="text-xs">
                      Press Enter or click the + button to add one or more email addresses
                    </FormDescription>
                  </div>
                </div>

                  {/* Submit Button */}
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending 
                      ? (mode === "create" ? "Creating..." : "Updating...")
                      : (mode === "create" ? "Create Recurring Task" : "Update Task")
                    }
                  </Button>
                </form>
              </Form>
            </div>
          )}
        </div>
        )}

        {isEditMode && editMetadataOnly && (
          <div className="mt-4">
            {/* METADATA-ONLY EDIT FORM */}
            <form onSubmit={handleMetadataSubmit} className="rounded-lg p-6 space-y-6 border border-gray-200">
              <div className="space-y-4">
                {/* Task Name */}
                <div>
                  <Label htmlFor="metadata-title">Task Name *</Label>
                  <Input
                    id="metadata-title"
                    value={metadataTitle}
                    onChange={(e) => setMetadataTitle(e.target.value)}
                    placeholder="e.g., Insurance Renewal"
                    className="mt-1"
                  />
                </div>

                {/* Contacts (Optional) */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-medium">Contacts (Optional)</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addMetadataContact}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Contact
                    </Button>
                  </div>
                  
                  {metadataContacts.length > 0 && (
                    <div className="space-y-3">
                      {metadataContacts.map((contact) => (
                        <div key={contact.id} className="p-3 border rounded-lg space-y-3 bg-muted/30">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                              <Label className="text-xs">Name *</Label>
                              <Input
                                value={contact.name}
                                onChange={(e) => updateMetadataContact(contact.id, 'name', e.target.value)}
                                placeholder="e.g., John Doe"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Mobile *</Label>
                              <Input
                                value={contact.mobile}
                                onChange={(e) => updateMetadataContact(contact.id, 'mobile', e.target.value)}
                                onBlur={() => validateMetadataContactMobile(contact.id)}
                                placeholder="e.g., +91 9876543210"
                                className={cn("mt-1", metadataContactErrors[contact.id] && "border-destructive")}
                              />
                              {metadataContactErrors[contact.id] && (
                                <p className="text-xs text-destructive mt-1">
                                  {metadataContactErrors[contact.id]}
                                </p>
                              )}
                            </div>
                            <div>
                              <Label className="text-xs">Designation</Label>
                              <Input
                                value={contact.designation}
                                onChange={(e) => updateMetadataContact(contact.id, 'designation', e.target.value)}
                                placeholder="e.g., Manager"
                                className="mt-1"
                              />
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMetadataContact(contact.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Email Recipients */}
                <div className="pt-4 border-t">
                  <Label className="mb-2 block">Email Recipients *</Label>
                  
                  {/* ✅ LOCKED STATE: Show info box when email recipients cannot be edited */}
                  {shouldLockEmailRecipients ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
                      <div className="flex items-start gap-2">
                        <svg className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 0h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v2h8z" />
                        </svg>
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-amber-900">Email recipients locked</h4>
                          <p className="text-xs text-amber-800 mt-1">
                            No future reminders remain for this task, so changing email recipients won't affect anything. Create a new task if you need to notify different recipients.
                          </p>
                          <p className="text-xs text-amber-700 mt-2 italic">
                            Past reminders are never modified for audit consistency.
                          </p>
                        </div>
                      </div>
                      {/* Show current recipients (read-only) */}
                      {metadataEmailRecipients.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-amber-700 mb-1">Current recipients (read-only):</p>
                          <div className="flex flex-wrap gap-2">
                            {metadataEmailRecipients.map((email) => (
                              <Badge key={email} variant="outline" className="text-xs bg-white">
                                {email}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ✅ EDITABLE STATE: Normal email input */
                    <>
                      <div className="flex gap-2 mb-2">
                        <Input
                          type="email"
                          placeholder="email@example.com"
                          value={metadataEmailInput}
                          onChange={(e) => setMetadataEmailInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addEmail(metadataEmailInput, metadataEmailRecipients, setMetadataEmailRecipients, setMetadataEmailInput);
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          onClick={() => addEmail(metadataEmailInput, metadataEmailRecipients, setMetadataEmailRecipients, setMetadataEmailInput)}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {metadataEmailRecipients.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {metadataEmailRecipients.map((email) => (
                            <Badge key={email} variant="secondary" className="gap-1">
                              {email}
                              <X
                                className="w-3 h-3 cursor-pointer"
                                onClick={() => removeEmail(email, metadataEmailRecipients, setMetadataEmailRecipients)}
                              />
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Press Enter or click the + button to add one or more email addresses
                        </p>
                        {/* ✅ Context-aware info message */}
                        {eligibleUpcomingUnsentCount === 0 && futureGenerationPossible ? (
                          <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                            💡 No upcoming unsent reminders to update. Changes will apply to future reminders only.
                          </p>
                        ) : eligibleUpcomingUnsentCount > 0 ? (
                          <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                            💡 Changes will apply to the task and upcoming unsent reminders. Sent/attempted reminders remain unchanged.
                          </p>
                        ) : (
                          <p className="text-xs text-blue-600 bg-blue-50 p-2 rounded">
                            💡 Changes will apply to the task and any upcoming unsent reminders. Already sent reminders remain unchanged.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Submit Button */}
                <div className="pt-4">
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={updateMetadataMutation.isPending}
                  >
                    {updateMetadataMutation.isPending ? "Updating..." : "Update"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        )}

        {isEditMode && !editMetadataOnly && (
          <div className="mt-4">
            {/* Edit mode is disabled - show informational message */}
            <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-6 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-amber-900 mb-2">
                    Editing is Disabled
                  </h3>
                  <p className="text-sm text-amber-800 leading-relaxed mb-3">
                    To modify this task, please <strong>delete it and create a new one</strong> with the updated details.
                  </p>
                  <p className="text-xs text-amber-700">
                    This ensures data consistency and prevents conflicts with scheduled reminders.
                  </p>
                </div>
              </div>
              
              <div className="pt-3 border-t border-amber-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="w-full"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

