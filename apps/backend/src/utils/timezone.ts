const IST_OFFSET_MINUTES = 5 * 60 + 30;

export function istDateTimeToUtc(date: string, time: string): Date {
  const [yearStr, monthStr, dayStr] = date.split("-");
  const [hourStr, minuteStr] = time.split(":");

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new Error(`istDateTimeToUtc: invalid date/time "${date} ${time}"`);
  }

  const istMillis = Date.UTC(year, month - 1, day, hour, minute);
  const utcMillis = istMillis - IST_OFFSET_MINUTES * 60 * 1000;

  return new Date(utcMillis);
}

export function istDateTimeToUtcIso(date: string, time: string): string {
  return istDateTimeToUtc(date, time).toISOString();
}

