/**
 * Server-side date guard utilities for task completion protection
 * Ensures tasks cannot be completed before their due date
 */

/**
 * Checks if a task/occurrence due date is today or in the past (IST timezone)
 * Used to enforce completion restrictions on the backend
 * 
 * @param dueDate - ISO string, Date object, or YYYY-MM-DD string
 * @returns true if due date is today or past, false if future or invalid
 */
export function isDueTodayOrPastIST(dueDate: string | Date | null | undefined): boolean {
  if (!dueDate) return false;
  
  try {
    let due: Date;
    
    if (typeof dueDate === 'string') {
      // Handle YYYY-MM-DD format (date-only)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        // Parse as IST date at midnight
        due = new Date(dueDate + 'T00:00:00+05:30');
      } else {
        // Parse ISO timestamp
        due = new Date(dueDate);
      }
    } else {
      due = dueDate;
    }
    
    // Invalid date check
    if (isNaN(due.getTime())) return false;
    
    // Get current date in IST
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    
    // Compare dates (start of day)
    const todayStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());
    const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    
    // Due date is today or past
    return dueStart.getTime() <= todayStart.getTime();
  } catch (error) {
    console.error('Error in isDueTodayOrPastIST:', error);
    return false;
  }
}

/**
 * Formats a due date for error messages
 * @param dueDate - ISO string or Date object
 * @returns Formatted date string
 */
export function formatDueDateForError(dueDate: string | Date | null | undefined): string {
  if (!dueDate) return 'the due date';
  
  try {
    const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
    if (isNaN(due.getTime())) return 'the due date';
    
    return due.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  } catch (error) {
    return 'the due date';
  }
}

