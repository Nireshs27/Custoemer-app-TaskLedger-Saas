import { emailService } from "./emailService";
import type { OccurrenceReminder } from "@shared/schema";

type OccurrenceReminderSendArgs = {
  row: OccurrenceReminder;
  recipient: string;
  channel: string;
  userName: string;
  taskSummary: {
    title: string;
    dueDate: string;
    category: string;
    daysRemaining: number;
  };
};

export async function attemptOccurrenceReminderSend({
  row,
  recipient,
  channel,
  userName,
  taskSummary,
}: OccurrenceReminderSendArgs): Promise<{
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  messageId?: string | null;
}> {
  if (channel !== 'email') {
    return {
      success: false,
      errorType: 'unsupported_channel',
      errorMessage: `Channel ${channel} is not yet supported`,
      messageId: null,
    };
  }

  const idempotencyKey = `${row.id}:${recipient}`;

  try {
    const result = await emailService.sendReminderEmail(
      recipient,
      userName,
      [taskSummary],
      { idempotencyKey },
    );

    if (!result.success) {
      return {
        success: false,
        errorType: result.errorType ?? 'email_send_error',
        errorMessage: result.errorMessage ?? 'Email send failed',
        messageId: null,
      };
    }

    return {
      success: true,
      messageId: result.messageId ?? null,
    };
  } catch (error) {
    return {
      success: false,
      errorType: 'email_exception',
      errorMessage: error instanceof Error ? error.message : String(error),
      messageId: null,
    };
  }
}
