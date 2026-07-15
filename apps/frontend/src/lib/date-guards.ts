/**
 * Date guard utilities for task completion protection
 * Ensures tasks cannot be completed before their due date
 */

import { startOfDay } from 'date-fns';

/**
 * Checks if a task/occurrence due date is today or in the past (local timezone)
 * Used to gate "Mark Complete" functionality
 * 
 * @param dueDate - ISO string, Date object, or null/undefined
 * @returns true if due date is today or past, false if future or invalid
 */
export function isDueTodayOrPast(dueDate: string | Date | null | undefined): boolean {
  if (!dueDate) return false;
  
  try {
    const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
    
    // Invalid date check
    if (isNaN(due.getTime())) return false;
    
    // Compare start of days in local timezone
    const todayStart = startOfDay(new Date());
    const dueStart = startOfDay(due);
    
    // Due date is today or past
    return dueStart.getTime() <= todayStart.getTime();
  } catch (error) {
    console.error('Error in isDueTodayOrPast:', error);
    return false;
  }
}

/**
 * Formats a due date for display in "Available on" messages
 * @param dueDate - ISO string or Date object
 * @returns Formatted date string like "Jan 3, 2026"
 */
export function formatDueDateMessage(dueDate: string | Date | null | undefined): string {
  if (!dueDate) return 'due date';
  
  try {
    const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
    if (isNaN(due.getTime())) return 'due date';
    
    return due.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  } catch (error) {
    return 'due date';
  }
}

