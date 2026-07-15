export interface EmailParams {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  /** Resend idempotency key — prevents duplicate sends on retry */
  idempotencyKey?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string | null;
  errorType?: string;
  errorMessage?: string;
}

export interface EmailTransport {
  isReady(): boolean;
  sendEmail(params: EmailParams): Promise<EmailSendResult>;
  shutdown(): Promise<void>;
  getProviderName(): string;
  getFromEmail(): string;
  getLastSendAt(): string | null;
}
