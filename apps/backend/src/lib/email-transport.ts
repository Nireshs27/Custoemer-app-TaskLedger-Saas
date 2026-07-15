import type { EmailParams, EmailSendResult, EmailTransport } from './email-types';
import { resendEmailService } from './resend-email-service';
import { smtpEmailService } from './smtp-email-service';

function resolveProvider(): 'resend' | 'smtp' {
  const explicit = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (explicit === 'resend' || explicit === 'smtp') {
    return explicit;
  }
  // Production defaults to Resend SDK. Local dev defaults to SMTP relay (works on Windows).
  return process.env.NODE_ENV === 'production' ? 'resend' : 'smtp';
}

class EmailTransportRouter implements EmailTransport {
  private active: EmailTransport;

  constructor() {
    const provider = resolveProvider();
    this.active = provider === 'resend' ? resendEmailService : smtpEmailService;
    console.log(`Email provider: ${this.active.getProviderName()}`);
  }

  getProviderName(): string {
    return this.active.getProviderName();
  }

  getFromEmail(): string {
    return this.active.getFromEmail();
  }

  getLastSendAt(): string | null {
    return this.active.getLastSendAt();
  }

  isReady(): boolean {
    return this.active.isReady();
  }

  async sendEmail(params: EmailParams): Promise<EmailSendResult> {
    return this.active.sendEmail(params);
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      resendEmailService.shutdown().catch(() => {}),
      smtpEmailService.shutdown().catch(() => {}),
    ]);
  }
}

export const emailTransport = new EmailTransportRouter();
export type { EmailParams, EmailSendResult, EmailTransport };
