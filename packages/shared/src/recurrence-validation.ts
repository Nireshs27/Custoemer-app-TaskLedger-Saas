/**
 * Shared Recurrence Data Validation Schema
 * Used by both frontend and backend for consistent validation
 * Implements strict validation for recurrenceData structure
 */

import { z } from "zod";
import {
  RECURRENCE_PATTERNS,
  RECURRENCE_MONTHLY_TYPES,
  RECURRENCE_MONTHLY_ORDINALS,
  RECURRENCE_END_TYPES,
} from "./recurrence-constants";

/**
 * Strict Zod schema for recurrence data
 * Validates all fields with proper types and ranges
 */
export const recurrenceDataSchema = z.object({
  // Pattern - must be one of the valid recurrence patterns
  pattern: z.enum([...RECURRENCE_PATTERNS], { 
    required_error: "Recurrence pattern is required",
    invalid_type_error: "Invalid recurrence pattern" 
  }),
  
  // Interval - how many units between recurrences (e.g., every 2 weeks)
  interval: z.number()
    .int("Interval must be a whole number")
    .min(1, "Interval must be at least 1")
    .max(999, "Interval cannot exceed 999"),
  
  // End type - how the recurrence ends
  endType: z.enum([...RECURRENCE_END_TYPES], {
    required_error: "End type is required",
    invalid_type_error: "Invalid end type"
  }),
  
  // End count - number of occurrences (required if endType is 'after')
  endCount: z.number()
    .int("Occurrence count must be a whole number")
    .min(1, "Must have at least 1 occurrence")
    .max(200, "Cannot exceed 200 occurrences")
    .optional(),
  
  // End date - when to stop (required if endType is 'on')
  endDate: z.union([z.string(), z.date()]).optional(),
  
  // Week days - which days of the week (0-6, where 0 is Sunday)
  weekDays: z.array(
    z.number().int().min(0).max(6)
  ).optional(),
  
  // Monthly type - by date or by day (e.g., 15th vs 2nd Tuesday)
  monthlyType: z.enum([...RECURRENCE_MONTHLY_TYPES]).optional(),

  // Monthly date - day of month (1-31)
  monthlyDate: z
    .number()
    .int("Monthly date must be a whole number")
    .min(1, "Day must be at least 1")
    .max(31, "Day cannot exceed 31")
    .optional(),

  // Monthly ordinal / weekday (e.g., third Saturday)
  monthlyOrdinal: z.enum([...RECURRENCE_MONTHLY_ORDINALS]).optional(),
  monthlyWeekday: z
    .number()
    .int("Monthly weekday must be a whole number")
    .min(0, "Weekday must be between 0 (Sunday) and 6 (Saturday)")
    .max(6, "Weekday must be between 0 (Sunday) and 6 (Saturday)")
    .optional(),

  // Start date - when the recurrence starts
  startDate: z.union([z.string(), z.date()]).optional(),
  
  // Quarterly fields
  quarterlyMonth: z.number().int().min(1).max(3).optional(),
  quarterlyDate: z.number().int().min(1).max(31).optional(),
  
  // Half-yearly fields  
  halfYearlyMonth: z.number().int().min(1).max(6).optional(),
  halfYearlyDate: z.number().int().min(1).max(31).optional(),
  
  // Yearly fields
  yearlyMonth: z.number().int().min(1).max(12).optional(),
  yearlyDate: z.number().int().min(1).max(31).optional(),
})
  .refine((data) => {
    // If endType is 'after', endCount is required
    if (data.endType === "after") {
      return data.endCount !== undefined && data.endCount > 0;
    }
    return true;
  }, {
    message: "End count is required when end type is 'after'",
    path: ["endCount"],
  })
  .refine((data) => {
    // If endType is 'on', endDate is required
    if (data.endType === "on") {
      return data.endDate !== undefined;
    }
    return true;
  }, {
    message: "End date is required when end type is 'on'",
    path: ["endDate"],
  })
  .refine((data) => {
    // Monthly type specific requirements
    if (data.monthlyType === "date") {
      return typeof data.monthlyDate === "number";
    }
    if (data.monthlyType === "ordinal" || data.monthlyType === "day") {
      return (
        typeof data.monthlyOrdinal === "string" &&
        typeof data.monthlyWeekday === "number"
      );
    }
    return true;
  }, {
    message: "Monthly recurrence requires the matching date or ordinal weekday fields",
    path: ["monthlyType"],
  });

/**
 * Type inference from the schema
 */
export type RecurrenceData = z.infer<typeof recurrenceDataSchema>;

