export const REMINDER_EMAIL_SUBJECT = "Task Ledger - 1 Upcoming Item";
export const REMINDER_FAILURE_USER_MESSAGE =
  "Failed to send email notification. We will retry automatically.";
export const SYSTEM_FALLBACK_RECIPIENT = "system@taskledger.local";

export const MISSED_REMINDER_MAX_ATTEMPTS = Number(
  process.env.MISSED_REMINDER_MAX_ATTEMPTS ?? "3"
);
export const MISSED_REMINDER_RETRY_INTERVAL_MINUTES = Number(
  process.env.MISSED_REMINDER_RETRY_INTERVAL_MINUTES ?? "15"
);
export const MISSED_REMINDER_RETRY_BATCH_SIZE = Number(
  process.env.MISSED_REMINDER_RETRY_BATCH_SIZE ?? "25"
);
export const MISSED_REMINDER_RETRY_CRON =
  process.env.MISSED_REMINDER_RETRY_CRON ?? "*/5 * * * *";

export const RETRYABLE_REMINDER_ERROR_TYPES = [
  "smtp_exception",
  "smtp_connection_error",
  "email_exception",
  "email_send_error",
  "resend_api_error",
] as const;

export const MANUAL_PERMANENT_FAILURE_ERROR_TYPE =
  "manual_permanent_failure";

