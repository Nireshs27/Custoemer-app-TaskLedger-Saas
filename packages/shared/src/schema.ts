import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, boolean, integer, decimal, uuid, date, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { recurrenceDataSchema } from "./recurrence-validation";

// Task Ledger Users table - specific authentication for Task Ledger app
export const taskledgerUsers = pgTable("taskledger_users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id"), // Added orgId for multi-tenancy support
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  permissions: jsonb("permissions").default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").default(true),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// HR Employees table (NEW)
export const hrEmployees = pgTable("hr_employees", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  firmId: uuid("firm_id").notNull(),
  employeeCode: text("employee_code").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name"),
  dateOfBirth: date("date_of_birth"),
  gender: text("gender"), // USER-DEFINED in DB
  maritalStatus: text("marital_status"), // USER-DEFINED in DB
  phone: text("phone"),
  email: text("email"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state").default(sql`'Tamil Nadu'::text`),
  pincode: text("pincode"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  employeeType: text("employee_type").notNull().default(sql`'REGULAR'::text`), // USER-DEFINED in DB
  isFixedTerm: boolean("is_fixed_term").notNull().default(false),
  fixedTermEndDate: date("fixed_term_end_date"),
  dateOfJoining: date("date_of_joining").notNull(),
  dateOfExit: date("date_of_exit"),
  exitReason: text("exit_reason"), // USER-DEFINED in DB
  currentDepartmentId: uuid("current_department_id"),
  currentShiftId: uuid("current_shift_id"),
  designation: text("designation"),
  reportingToId: uuid("reporting_to_id"),
  pan: text("pan"),
  aadhaarMasked: text("aadhaar_masked"),
  uan: text("uan"),
  esicNumber: text("esic_number"),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  ifsc: text("ifsc"),
  pfApplicable: boolean("pf_applicable").notNull().default(true),
  esiApplicable: boolean("esi_applicable").notNull().default(true),
  ptApplicable: boolean("pt_applicable").notNull().default(true),
  lwfApplicable: boolean("lwf_applicable").notNull().default(true),
  doubleEmploymentDeclared: boolean("double_employment_declared").notNull().default(false),
  currentPhotoId: uuid("current_photo_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  bloodGroup: text("blood_group"),
  nationality: text("nationality").default(sql`'Indian'::text`),
  phoneSecondary: text("phone_secondary"),
  staffType: text("staff_type"),
  probationPeriodMonths: integer("probation_period_months").default(6),
  confirmationDate: date("confirmation_date"),
  priorExperienceMonths: integer("prior_experience_months").default(0),
  drivingLicense: text("driving_license"),
  voterId: text("voter_id"),
  rationCard: text("ration_card"),
  fatherName: text("father_name"),
  fatherPhone: text("father_phone"),
  fatherAadhaarMasked: text("father_aadhaar_masked"),
  motherName: text("mother_name"),
  motherPhone: text("mother_phone"),
  motherAadhaarMasked: text("mother_aadhaar_masked"),
  emergencyContactRelationship: text("emergency_contact_relationship"),
  workingDaysPerMonth: integer("working_days_per_month"),
  customWeeklyOff: text("custom_weekly_off").array(),
  pfNumber: text("pf_number"),
  customHoursPerDay: decimal("custom_hours_per_day"),
  currentLocationId: integer("current_location_id"),
  userId: uuid("user_id"),
});

// Properties table
export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address").notNull(),
  propertyType: text("property_type").notNull(), // 'office', 'residential', 'warehouse', etc.
  city: text("city").notNull(),
  state: text("state").notNull(),
  pincode: text("pincode"),
  numberOfFloors: integer("number_of_floors").default(1),
  propertyTaxOldNumber: text("property_tax_old_number"), // Chennai Corporation old number
  propertyTaxNewNumber: text("property_tax_new_number"), // Chennai Corporation new number
  ebNumbers: jsonb("eb_numbers").default(sql`'{}'::jsonb`), // EB numbers for all floors including ground floor and common area
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Tax & Legal Compliance (NEW MODULE)
// Parent container table: tax_legal_compliances
export const taxLegalCompliances = pgTable("tax_legal_compliances", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  note: text("note"),
  loginId: text("login_id"),
  category: uuid("category").references(() => taxTrackerCategories.id, { onDelete: "set null" }), // FK to tax_tracker_categories
  subCategory: text("sub_category"),
  propertyId: uuid("property_id").references(() => properties.id),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Child task table: tax_legal_items
export const taxLegalItems = pgTable("tax_legal_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  complianceId: uuid("compliance_id")
    .notNull()
    .references(() => taxLegalCompliances.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: date("due_date").notNull(),
  dueTime: text("due_time"),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  status: text("status").notNull().default("pending"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceData: jsonb("recurrence_data"),
  nextDueDate: date("next_due_date"),
  notes: text("notes"),
  completionNotes: text("completion_notes"),
  completedAt: timestamp("completed_at"),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  // ✅ FIX: Added missing emailRecipients column (exists in DB via migration, was missing from schema)
  emailRecipients: jsonb("email_recipients").default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

// Enhanced Vehicles table with comprehensive details
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Basic Vehicle Information
  vehicleName: text("vehicle_name").notNull(), // User-friendly name for the vehicle
  registrationNumber: text("registration_number").notNull().unique(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vehicleType: text("vehicle_type").notNull(), // 'car', 'truck', 'bike', etc.
  
  // RTO Registration Details
  registeredName: text("registered_name").notNull(), // Name as registered in RTO
  registeredMobile: text("registered_mobile").notNull(), // Mobile number in RTO
  registeredEmail: text("registered_email"), // Email as registered in RTO (optional)
  
  // Purchase and Sale Information
  purchaseDate: date("purchase_date"),
  purchaseAmount: decimal("purchase_amount", { precision: 15, scale: 2 }),
  soldDate: date("sold_date"), // When vehicle was sold (optional)
  soldToName: text("sold_to_name"), // Name of person/entity sold to
  soldToMobile: text("sold_to_mobile"), // Contact of buyer
  soldToEmail: text("sold_to_email"), // Email of buyer
  soldAmount: decimal("sold_amount", { precision: 15, scale: 2 }), // Sale price
  
  // Insurance Information  
  currentInsuranceDueDate: date("current_insurance_due_date"),
  // Insurance period removed - now stored in vehicle or as task notes
  // insurancePeriodStart: date("insurance_period_start"),
  // insurancePeriodEnd: date("insurance_period_end"),
  insuranceProvider: text("insurance_provider"),
  insurancePolicyNumber: text("insurance_policy_number"),
  
  // Status and Metadata
  status: text("status").notNull().default("active"), // 'active', 'sold', 'disposed'
  propertyId: uuid("property_id").references(() => properties.id),
  notes: text("notes"),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Enhanced Vehicle Insurance and other vehicle-related items with advanced Google Tasks-like features
export const vehicleItems = pgTable("vehicle_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"), // Added description field
  dueDate: date("due_date").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  status: text("status").notNull().default("pending"), // 'pending', 'completed', 'overdue'
  
  // Recurring options - Google Tasks-like functionality (same as tax items)
  isRecurring: boolean("is_recurring").default(false),
  recurrencePattern: text("recurrence_pattern"), // 'monthly', 'quarterly', 'annual', 'custom'
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceEndDate: date("recurrence_end_date"),
  nextDueDate: date("next_due_date"),
  recurrenceData: jsonb("recurrence_data"), // Full Google Tasks recurrence data
  
  // Advanced reminder system - Google Tasks-like functionality
  reminderDays: integer("reminder_days").default(7),
  reminderOffsetValue: integer("reminder_offset_value").default(7),
  reminderOffsetUnit: text("reminder_offset_unit").notNull().default('days'),
  customReminderDates: jsonb("custom_reminder_dates").default(sql`'[]'::jsonb`),
  reminderTimes: jsonb("reminder_times").default(sql`'["09:00"]'::jsonb`),
  
  // Multi-channel notification preferences
  notificationChannels: jsonb("notification_channels").default(sql`'["email"]'::jsonb`),
  emailRecipients: jsonb("email_recipients").default(sql`'[]'::jsonb`),
  whatsappRecipients: jsonb("whatsapp_recipients").default(sql`'[]'::jsonb`),
  smsRecipients: jsonb("sms_recipients").default(sql`'[]'::jsonb`),
  
  notes: text("notes"),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  completedAt: timestamp("completed_at"),
  completionNotes: text("completion_notes"), // Task completion notes/results
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Assets and Machinery table
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  assetType: text("asset_type").notNull(), // 'machinery', 'equipment', 'furniture', etc.
  serialNumber: text("serial_number"),
  boughtUnder: text("bought_under"),
  depreciationPercent: decimal("depreciation_percent", { precision: 10, scale: 2 }),
  depreciationMethod: text("depreciation_method"),
  propertyId: uuid("property_id").references(() => properties.id),
  purchaseDate: date("purchase_date"),
  purchaseAmount: decimal("purchase_amount", { precision: 15, scale: 2 }),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Asset Items (mirrors vehicle_items; tasks/reminders for assets)
export const assetItems = pgTable("asset_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: date("due_date").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }),
  status: text("status").notNull().default("pending"),

  // Recurrence
  isRecurring: boolean("is_recurring").default(false),
  recurrencePattern: text("recurrence_pattern"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceEndDate: date("recurrence_end_date"),
  nextDueDate: date("next_due_date"),
  recurrenceData: jsonb("recurrence_data"),

  // Reminders
  reminderDays: integer("reminder_days").default(7),
  reminderOffsetValue: integer("reminder_offset_value").default(7),
  reminderOffsetUnit: text("reminder_offset_unit").notNull().default("days"),
  customReminderDates: jsonb("custom_reminder_dates").default(sql`'[]'::jsonb`),
  reminderTimes: jsonb("reminder_times").default(sql`'["09:00"]'::jsonb`),

  // Multi-channel notification preferences
  notificationChannels: jsonb("notification_channels").default(sql`'["email"]'::jsonb`),
  emailRecipients: jsonb("email_recipients").default(sql`'[]'::jsonb`),
  whatsappRecipients: jsonb("whatsapp_recipients").default(sql`'[]'::jsonb`),
  smsRecipients: jsonb("sms_recipients").default(sql`'[]'::jsonb`),

  notes: text("notes"),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  completedAt: timestamp("completed_at"),
  completionNotes: text("completion_notes"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Task Actions table for managing action items and tasks
export const taskActions = pgTable("task_actions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  category: uuid("category").references(() => taxTrackerCategories.id, { onDelete: "set null" }), // FK to tax_tracker_categories
  priority: text("priority").notNull().default("low"), // 'low', 'medium', 'high'
  status: text("status").notNull().default("pending"), // 'pending', 'in_progress', 'completed', 'on_hold'
  
  // Multiple assignees with name and id
  assignees: jsonb("assignees").default(sql`'[]'::jsonb`), // Array of {id: string, name: string}
  
  // Task points/responsibilities
  taskPoints: jsonb("task_points").default(sql`'[]'::jsonb`), // Array of task responsibility strings
  
  // Recurring task options - same as other entities
  isRecurring: boolean("is_recurring").default(false),
  recurrenceData: jsonb("recurrence_data"), // Serialized RecurrenceData
  
  // Advanced reminder system - same as other entities
  reminderDays: integer("reminder_days").default(7),
  customReminderDates: jsonb("custom_reminder_dates").default(sql`'[]'::jsonb`),
  reminderTimes: jsonb("reminder_times").default(sql`'["09:00"]'::jsonb`),
  
  // Notification preferences
  notificationChannels: jsonb("notification_channels").default(sql`'["email"]'::jsonb`),
  emailRecipients: jsonb("email_recipients").default(sql`'[]'::jsonb`),
  whatsappRecipients: jsonb("whatsapp_recipients").default(sql`'[]'::jsonb`),
  smsRecipients: jsonb("sms_recipients").default(sql`'[]'::jsonb`),
  
  // Task completion
  completedAt: timestamp("completed_at"),
  completionNotes: text("completion_notes"), // Task completion notes/results
  
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Task Action Items (mirrors vehicle/asset items; child tasks of task_actions)
export const taskActionItems = pgTable("task_action_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  taskActionId: uuid("task_action_id")
    .notNull()
    .references(() => taskActions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").default(""),
  dueDate: date("due_date").notNull(),
  dueTime: text("due_time"),
  status: text("status").notNull().default("pending"),
  isRecurring: boolean("is_recurring").default(false),
  recurrencePattern: text("recurrence_pattern"),
  recurrenceInterval: integer("recurrence_interval").default(1),
  recurrenceEndDate: date("recurrence_end_date"),
  nextDueDate: date("next_due_date"),
  recurrenceData: jsonb("recurrence_data"),
  reminderDays: integer("reminder_days").default(7),
  reminderOffsetValue: integer("reminder_offset_value").default(7),
  reminderOffsetUnit: text("reminder_offset_unit").notNull().default("days"),
  customReminderDates: jsonb("custom_reminder_dates").default(sql`'[]'::jsonb`),
  reminderTimes: jsonb("reminder_times").default(sql`'["09:00"]'::jsonb`),
  notificationChannels: jsonb("notification_channels").default(sql`'["email"]'::jsonb`),
  emailRecipients: jsonb("email_recipients").default(sql`'[]'::jsonb`),
  whatsappRecipients: jsonb("whatsapp_recipients").default(sql`'[]'::jsonb`),
  smsRecipients: jsonb("sms_recipients").default(sql`'[]'::jsonb`),
  customFields: jsonb("custom_fields").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// ⭐ Task Ledger Documents (new normalized structure with bucket_key, not signed URLs)
export const taskLedgerDocuments = pgTable("task_ledger_documents", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull(), // Organization scope
  bucketKey: text("bucket_key").notNull(), // Stable storage path (not signed URL)
  originalName: text("original_name").notNull(),
  fileName: text("file_name"), // Optional sanitized name
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"), // Deduplication hash
  pendingDelete: boolean("pending_delete").notNull().default(false), // Soft-delete flag for safe cleanup
  // ✅ Task Ledger auth table (matches DB FK: taskledger_users.id)
  createdBy: uuid("created_by").notNull().references(() => taskledgerUsers.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  orgIdIdx: index("idx_task_ledger_docs_org_id").on(table.orgId),
  pendingDeleteIdx: index("idx_task_ledger_docs_pending_delete").on(table.pendingDelete),
}));

// ⭐ Task Ledger Document Links (entity relationships for documents)
export const taskLedgerDocumentLinks = pgTable("task_ledger_document_links", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id").notNull(), // Organization scope
  documentId: uuid("document_id").notNull().references(() => taskLedgerDocuments.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // 'property', 'vehicle', 'asset', 'task_action', 'tax_legal_compliance'
  entityId: uuid("entity_id").notNull(),
  documentType: text("document_type"), // 'tax_receipt', 'license', 'insurance', etc. (optional)
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => ({
  // ✅ Prevent duplicate attachments of same doc to same entity (matches your SQL unique index intent)
  uqLink: unique("uq_task_ledger_link_unique").on(
    table.orgId,
    table.documentId,
    table.entityType,
    table.entityId
  ),
  orgIdIdx: index("idx_task_ledger_links_org_id").on(table.orgId),
  entityIdx: index("idx_task_ledger_links_entity").on(table.entityType, table.entityId),
}));

// ⭐ Occurrence Reminders (New unified reminder engine)
export const occurrenceReminders = pgTable("occurrence_reminders", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => taskledgerUsers.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  occurrenceTaskUtc: timestamp("occurrence_task_utc").notNull(),
  occurrenceKey: text("occurrence_key").notNull(),
  taskStatus: text("task_status").notNull().default("pending"),
  completedAt: timestamp("completed_at"),
  taskNote: text("task_note"),
  dueDateLocalYmd: text("due_date_local_ymd").notNull(),
  reminderAtUtc: timestamp("reminder_at_utc").notNull(),
  reminderChannel: text("reminder_channel").notNull().default("email"),
  recipientStatus: jsonb("recipient_status").notNull().default(sql`'{}'::jsonb`),
  taskTitle: text("task_title").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => {
  return {
    uqInstance: unique("occurrence_reminders_uq_instance").on(
      table.userId,
      table.occurrenceKey,
      table.reminderChannel
    ),
  };
});

export type OccurrenceReminder = typeof occurrenceReminders.$inferSelect;
export type InsertOccurrenceReminder = typeof occurrenceReminders.$inferInsert;

// Per-recipient status stored in recipientStatus JSONB
export type RecipientStatus = {
  status: "pending" | "sent" | "failed" | "cancelled";
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  message_id: string | null;
  next_retry_at: string | null;
};

// Tax Tracker Categories - Centralized category management
export const taxTrackerCategories = pgTable("tax_tracker_categories", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  module: text("module").notNull(), // 'vehicle', 'asset', 'task_action', 'tax_legal', 'reminder_tasks'
  name: text("name").notNull(), // Display name
  slug: text("slug").notNull(), // URL-safe identifier (kebab-case)
  isSystem: boolean("is_system").notNull().default(false), // System categories cannot be deleted
  isActive: boolean("is_active").notNull().default(true), // Soft delete flag
  sortOrder: integer("sort_order").notNull().default(0), // Display order
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => ({
  moduleSlugUnique: unique("tax_tracker_categories_module_slug_unique").on(table.module, table.slug),
}));

// Zod schemas for Tax Tracker Categories
export const insertTaxTrackerCategorySchema = createInsertSchema(taxTrackerCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTaxTrackerCategory = z.infer<typeof insertTaxTrackerCategorySchema>;
export type SelectTaxTrackerCategory = typeof taxTrackerCategories.$inferSelect;
export type TaxTrackerCategory = typeof taxTrackerCategories.$inferSelect;

// Calendar Events table for quick events (meetings, appointments, etc.)
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"), // Optional event description
  eventDate: date("event_date").notNull(),
  eventTime: text("event_time"), // Optional time (e.g., "10:00 AM")
  status: text("status").notNull().default("upcoming"), // 'upcoming', 'completed', 'cancelled'
  
  // Simple reminder system (similar to vehicle items)
  reminderDays: integer("reminder_days").default(1), // Default 1 day before
  reminderTimes: jsonb("reminder_times").default(sql`'["09:00"]'::jsonb`), // Array of times to send reminders
  
  // Notification preferences - multiple channels
  notificationChannels: jsonb("notification_channels").default(sql`'["email"]'::jsonb`), // ['email', 'whatsapp', 'sms']
  emailRecipients: jsonb("email_recipients").default(sql`'[]'::jsonb`), // Array of email addresses
  whatsappRecipients: jsonb("whatsapp_recipients").default(sql`'[]'::jsonb`), // Array of WhatsApp numbers
  smsRecipients: jsonb("sms_recipients").default(sql`'[]'::jsonb`), // Array of SMS numbers
  
  // Metadata
  createdBy: uuid("created_by").notNull().references(() => taskledgerUsers.id),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

// Zod schema for Calendar Events
export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).extend({
  reminderTimes: z.array(z.string()).optional(),
  notificationChannels: z.array(z.enum(['email', 'whatsapp', 'sms'])).optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  whatsappRecipients: z.array(z.string()).optional(),
  smsRecipients: z.array(z.string()).optional(),
});

export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type SelectCalendarEvent = typeof calendarEvents.$inferSelect;

export type HrEmployee = typeof hrEmployees.$inferSelect;
export type InsertHrEmployee = typeof hrEmployees.$inferInsert;
export type CalendarEvent = Omit<typeof calendarEvents.$inferSelect, 'reminderTimes' | 'notificationChannels' | 'emailRecipients' | 'whatsappRecipients' | 'smsRecipients'> & {
  reminderTimes?: string[];
  notificationChannels?: ('email' | 'whatsapp' | 'sms')[];
  emailRecipients?: string[];
  whatsappRecipients?: string[];
  smsRecipients?: string[];
};

// Zod schemas for Task Ledger Users
export const insertTaskLedgerUserSchema = createInsertSchema(taskledgerUsers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TaskLedgerUser = typeof taskledgerUsers.$inferSelect;
export type InsertTaskLedgerUser = z.infer<typeof insertTaskLedgerUserSchema>;

// Zod schemas for Properties
export const insertPropertySchema = createInsertSchema(properties).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;

// Zod schemas for Vehicles
export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;

// Zod schemas for Vehicle Items
export const vehicleItemSchemaBase = createInsertSchema(vehicleItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).extend({
  // Enhanced validation for new Google Tasks-like features
  taskName: z.string().optional(),
  taskNotes: z.string().optional(),
  customReminderDates: z.array(z.string()).optional(),
  reminderTimes: z.array(z.string()).optional(),
  notificationChannels: z.array(z.enum(['email', 'whatsapp', 'sms'])).optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  whatsappRecipients: z.array(z.string()).optional(),
  smsRecipients: z.array(z.string()).optional(),
  recurrenceData: recurrenceDataSchema.optional().nullable(),  // ⭐ STRICT VALIDATION
}).passthrough();

export const insertVehicleItemSchema = vehicleItemSchemaBase
  .superRefine((data, ctx) => {
    // ⭐ BACKEND VALIDATION: If email channel is selected, at least one email required
    if (data.notificationChannels?.includes('email')) {
      if (!data.emailRecipients || data.emailRecipients.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one email recipient is required when email notifications are enabled",
          path: ["emailRecipients"],
        });
      }
    }
  })
  .superRefine((data, ctx) => {
    // ⭐ BACKEND VALIDATION: If recurring, recurrenceData is required and valid
    if (data.isRecurring) {
      if (data.recurrenceData === null || data.recurrenceData === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recurrence configuration is required for recurring tasks",
          path: ["recurrenceData"],
        });
      }
    }
  });

export const updateVehicleItemSchema = vehicleItemSchemaBase.partial();

export type VehicleItem = typeof vehicleItems.$inferSelect;
export type InsertVehicleItem = z.infer<typeof insertVehicleItemSchema>;
export type UpdateVehicleItem = z.infer<typeof updateVehicleItemSchema>;

// Zod schemas for Assets
export const insertAssetSchema = createInsertSchema(assets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  purchaseAmount: z.preprocess(
    (v) => (typeof v === "number" ? String(v) : v),
    z.string()
  ).optional().nullable(),
  depreciationPercent: z.preprocess(
    (v) => (typeof v === "number" ? String(v) : v),
    z.string()
  ).optional().nullable(),
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = z.infer<typeof insertAssetSchema>;

// Zod schemas for Asset Items
export const assetItemSchemaBase = createInsertSchema(assetItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).passthrough();

export const insertAssetItemSchema = assetItemSchemaBase
  .superRefine((data, ctx) => {
    if (Array.isArray((data as any).notificationChannels) && (data as any).notificationChannels.includes('email')) {
      const emailRecipients = Array.isArray((data as any).emailRecipients) ? (data as any).emailRecipients : [];
      if (emailRecipients.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one email recipient is required when email notifications are enabled",
          path: ["emailRecipients"],
        });
      }
    }
  })
  .superRefine((data, ctx) => {
    if (data.isRecurring) {
      if (data.recurrenceData === null || data.recurrenceData === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recurrence configuration is required for recurring tasks",
          path: ["recurrenceData"],
        });
      }
    }
  });

export const updateAssetItemSchema = assetItemSchemaBase.partial();

export type AssetItem = typeof assetItems.$inferSelect;
export type InsertAssetItem = z.infer<typeof insertAssetItemSchema>;
export type UpdateAssetItem = z.infer<typeof updateAssetItemSchema>;

// Zod schemas for Task Actions
export const insertTaskActionSchema = createInsertSchema(taskActions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
}).extend({
  assignees: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  taskPoints: z.array(z.string()).optional(),
  customReminderDates: z.array(z.string()).optional(),
  reminderTimes: z.array(z.string()).optional(),
  notificationChannels: z.array(z.enum(['email', 'whatsapp', 'sms'])).optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  whatsappRecipients: z.array(z.string()).optional(),
  smsRecipients: z.array(z.string()).optional(),
});

export type TaskAction = Omit<typeof taskActions.$inferSelect, 'assignees' | 'taskPoints' | 'recurrenceData' | 'customReminderDates' | 'reminderTimes' | 'notificationChannels' | 'emailRecipients' | 'whatsappRecipients' | 'smsRecipients'> & {
  assignees?: Array<{ id: string; name: string }>;
  taskPoints?: string[];
  recurrenceData?: any;
  customReminderDates?: string[];
  reminderTimes?: string[];
  notificationChannels?: ('email' | 'whatsapp' | 'sms')[];
  emailRecipients?: string[];
  whatsappRecipients?: string[];
  smsRecipients?: string[];
};
export type InsertTaskAction = z.infer<typeof insertTaskActionSchema>;

// Zod schemas for Task Action Items
export const insertTaskActionItemSchema = createInsertSchema(taskActionItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).passthrough()
  .superRefine((data, ctx) => {
    if (
      Array.isArray((data as any).notificationChannels) &&
      (data as any).notificationChannels.includes("email")
    ) {
      const emailRecipients = Array.isArray((data as any).emailRecipients)
        ? (data as any).emailRecipients
        : [];
      if (emailRecipients.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "At least one email recipient is required when email notifications are enabled",
          path: ["emailRecipients"],
        });
      }
    }
  })
  .superRefine((data, ctx) => {
    if (data.isRecurring) {
      if (data.recurrenceData === null || data.recurrenceData === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recurrence configuration is required for recurring tasks",
          path: ["recurrenceData"],
        });
      }
    }
  });

export const updateTaskActionItemSchema = createInsertSchema(taskActionItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial().passthrough();

export type TaskActionItem = typeof taskActionItems.$inferSelect;
export type InsertTaskActionItem = z.infer<typeof insertTaskActionItemSchema>;
export type UpdateTaskActionItem = z.infer<typeof updateTaskActionItemSchema>;

// Zod schemas for Tax & Legal Compliance
export const insertTaxLegalComplianceSchema = createInsertSchema(taxLegalCompliances).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TaxLegalCompliance = typeof taxLegalCompliances.$inferSelect;
export type InsertTaxLegalCompliance = z.infer<typeof insertTaxLegalComplianceSchema>;

// Zod schemas for Tax & Legal Items
export const insertTaxLegalItemSchema = createInsertSchema(taxLegalItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
});

export type TaxLegalItem = typeof taxLegalItems.$inferSelect;
export type InsertTaxLegalItem = z.infer<typeof insertTaxLegalItemSchema>;

// Task Ledger Documents schemas
export const insertTaskLedgerDocumentSchema = createInsertSchema(taskLedgerDocuments).omit({
  id: true,
  createdAt: true,
});

export type TaskLedgerDocument = typeof taskLedgerDocuments.$inferSelect;
export type InsertTaskLedgerDocument = z.infer<typeof insertTaskLedgerDocumentSchema>;

export const insertTaskLedgerDocumentLinkSchema = createInsertSchema(taskLedgerDocumentLinks).omit({
  id: true,
  createdAt: true,
});

export type TaskLedgerDocumentLink = typeof taskLedgerDocumentLinks.$inferSelect;
export type InsertTaskLedgerDocumentLink = z.infer<typeof insertTaskLedgerDocumentLinkSchema>;

// HR Employee Photos table
export const hrEmployeePhotos = pgTable("hr_employee_photos", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: uuid("employee_id").notNull(),
  storagePath: text("storage_path").notNull(),
  effectiveFrom: date("effective_from"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export type HrEmployeePhoto = typeof hrEmployeePhotos.$inferSelect;
export type InsertHrEmployeePhoto = typeof hrEmployeePhotos.$inferInsert;
