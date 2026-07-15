import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert 24-hour time format to 12-hour format with AM/PM
 * @param time24 - Time in 24-hour format (HH:MM)
 * @returns Time in 12-hour format (H:MM AM/PM)
 * @example convert24To12Hour("09:00") => "9:00 AM"
 * @example convert24To12Hour("13:30") => "1:30 PM"
 * @example convert24To12Hour("00:00") => "12:00 AM"
 */
export function convert24To12Hour(time24: string): string {
  const [hour24Str, minuteStr] = time24.split(':');
  const hour24 = parseInt(hour24Str);
  const minute = parseInt(minuteStr);
  
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  
  return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
}

/**
 * Convert 12-hour time format to 24-hour format
 * @param time12 - Time in 12-hour format (H:MM AM/PM)
 * @returns Time in 24-hour format (HH:MM)
 * @example convert12To24Hour("9:00 AM") => "09:00"
 * @example convert12To24Hour("1:30 PM") => "13:30"
 * @example convert12To24Hour("12:00 AM") => "00:00"
 */
export function convert12To24Hour(time12: string): string {
  const match = time12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return time12; // Return as-is if format doesn't match
  
  let hour = parseInt(match[1]);
  const minute = match[2];
  const period = match[3].toUpperCase();
  
  if (period === 'AM' && hour === 12) {
    hour = 0;
  } else if (period === 'PM' && hour !== 12) {
    hour += 12;
  }
  
  return `${hour.toString().padStart(2, '0')}:${minute}`;
}

/**
 * Convert UTC date/time to IST (Indian Standard Time)
 * IST is UTC+5:30
 * @param utcDate - Date in UTC timezone (ISO string or Date object)
 * @returns Date object representing IST time
 * @example convertUTCtoIST("2025-11-20T10:00:00Z") => Date for 15:30 same day
 */
export function convertUTCtoIST(utcDate: Date | string): Date {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  
  // IST is UTC + 5 hours 30 minutes
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istTime = new Date(date.getTime() + istOffset);
  
  return istTime;
}

/**
 * Convert IST date/time to UTC
 * IST is UTC+5:30
 * @param istDate - Date in IST timezone
 * @returns Date converted to UTC timezone
 * @example convertISTtoUTC(new Date("2025-11-20T15:30:00")) => Date for 10:00 UTC same day
 */
export function convertISTtoUTC(istDate: Date | string): Date {
  const date = typeof istDate === 'string' ? new Date(istDate) : istDate;
  
  // IST is UTC + 5 hours 30 minutes, so subtract to get UTC
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const utcTime = new Date(date.getTime() - istOffset);
  
  return utcTime;
}

/**
 * Format a UTC date/time as IST string
 * @param utcDate - Date in UTC timezone (ISO string or Date object)
 * @param includeTime - Whether to include time in the output
 * @returns Formatted string showing IST time
 * @example formatUTCasIST("2025-11-20T10:00:00Z", true) => "Nov 20, 2025 at 3:30 PM IST"
 */
export function formatUTCasIST(utcDate: Date | string, includeTime: boolean = true): string {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  
  // Add IST offset (5 hours 30 minutes)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffset);
  
  // Use UTC methods to format the shifted time (which now represents IST)
  const year = istTime.getUTCFullYear();
  const month = istTime.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = istTime.getUTCDate();
  
  const dateStr = `${month} ${day}, ${year}`;
  
  if (!includeTime) {
    return `${dateStr} IST`;
  }
  
  // Format time in 12-hour format
  let hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  
  const timeStr = `${hours}:${minutesStr} ${ampm}`;
  
  return `${dateStr} at ${timeStr} IST`;
}