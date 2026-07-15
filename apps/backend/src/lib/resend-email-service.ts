import { Resend } from 'resend';
import type { EmailParams, EmailSendResult, EmailTransport } from './email-types';

function classifyResendError(error: unknown): { errorType: string; errorMessage: string } {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('rate limit') || lower.includes('429')) {
    return { errorType: 'resend_api_error', errorMessage: message };
  }
  if (
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('econnrefused') ||
    lower.includes('could not be resolved') ||
    lower.includes('fetch')
  ) {
    return { errorType: 'email_send_error', errorMessage: message };
  }
  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('422')) {
    return { errorType: 'resend_validation_error', errorMessage: message };
  }

  return { errorType: 'resend_api_error', errorMessage: message };
}

class ResendEmailService implements EmailTransport {
  private client: Resend | null = null;
  private isConfigured = false;
  private lastSendAt: string | null = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    const apiKey = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
    if (!apiKey || !apiKey.startsWith('re_')) {
      console.warn('Resend API key not configured. Set RESEND_API_KEY.');
      this.isConfigured = false;
      return;
    }

    this.client = new Resend(apiKey);
    this.isConfigured = true;
    console.log('Resend Email Service initialized');
    console.log(`   From: ${this.getFromEmail()}`);
  }

  getProviderName(): string {
    return 'resend';
  }

  getFromEmail(): string {
    return process.env.SMTP_FROM_EMAIL || 'noreply@taskledger.com';
  }

  getLastSendAt(): string | null {
    return this.lastSendAt;
  }

  isReady(): boolean {
    return this.isConfigured && this.client !== null;
  }

  async sendEmail(params: EmailParams): Promise<EmailSendResult> {
    if (!this.isConfigured || !this.client) {
      return {
        success: false,
        errorType: 'email_send_error',
        errorMessage: 'Resend not configured',
      };
    }

    const fromEmail = this.getFromEmail();
    const fromName = process.env.SMTP_FROM_NAME || 'Task Ledger';
    const to = Array.isArray(params.to) ? params.to : [params.to];

    try {
      const sendOptions: Parameters<Resend['emails']['send']>[0] = {
        from: `${fromName} <${fromEmail}>`,
        to,
        subject: params.subject,
        text: params.text || '',
        html: params.html || params.text || '',
      };

      const result = params.idempotencyKey
        ? await this.client.emails.send(sendOptions, { idempotencyKey: params.idempotencyKey })
        : await this.client.emails.send(sendOptions);

      if (result.error) {
        const classified = classifyResendError(result.error);
        console.error('Resend send failed:', result.error);
        return {
          success: false,
          messageId: null,
          ...classified,
        };
      }

      this.lastSendAt = new Date().toISOString();
      const messageId = result.data?.id ?? null;

      console.log('Email sent successfully (Resend)');
      console.log(`   To: ${to.join(', ')}`);
      console.log(`   Subject: ${params.subject}`);
      console.log(`   Message ID: ${messageId}`);

      return { success: true, messageId };
    } catch (error) {
      const classified = classifyResendError(error);
      console.error('Resend send exception:', error);
      return {
        success: false,
        messageId: null,
        ...classified,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.client = null;
    this.isConfigured = false;
  }
}

export const resendEmailService = new ResendEmailService();
