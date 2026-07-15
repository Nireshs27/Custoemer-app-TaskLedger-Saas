import { formatUTCasIST } from "@/lib/utils";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_WITH_OPTIONAL_MERIDIEM_REGEX = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i;

function parseTimeString(timeStr?: string | null): { hours: number; minutes: number } | null {
  if (!timeStr) {
    return null;
  }

  const match = TIME_WITH_OPTIONAL_MERIDIEM_REGEX.exec(timeStr.trim());
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) {
    hours += 12;
  } else if (meridiem === "AM" && hours === 12) {
    hours = 0;
  }

  return {
    hours: hours % 24,
    minutes,
  };
}

export function combineDateAndTimeToIso(
  dateStr?: string | null,
  timeStr?: string | null
): string | undefined {
  if (!dateStr) {
    return undefined;
  }

  if (!DATE_ONLY_REGEX.test(dateStr)) {
    return dateStr;
  }

  const [year, month, day] = dateStr.split("-").map(Number);
  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return dateStr;
  }

  const timeParts = parseTimeString(timeStr);
  if (!timeParts) {
    return dateStr;
  }

  const localDate = new Date(year, month - 1, day, timeParts.hours, timeParts.minutes, 0, 0);
  return localDate.toISOString();
}

export function parseDateWithOptionalTime(
  value?: string | Date | null,
  fallbackTime?: string | null
): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : new Date(value);
  }

  if (!DATE_ONLY_REGEX.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const [year, month, day] = value.split("-").map(Number);
  if ([year, month, day].some((num) => Number.isNaN(num))) {
    return undefined;
  }

  const timeParts = parseTimeString(fallbackTime ?? "09:00");
  if (!timeParts) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return new Date(year, month - 1, day, timeParts.hours, timeParts.minutes, 0, 0);
}

export function formatUtcToIstDisplay(utcString?: string | null): string {
  if (!utcString) return "";
  const raw = utcString.trim();
  if (!raw) return "";

  const hasTz = /[zZ]$|[+-]\d{2}:\d{2}$/.test(raw);
  if (!hasTz) {
    return raw;
  }

  return formatUTCasIST(raw, true);
}

