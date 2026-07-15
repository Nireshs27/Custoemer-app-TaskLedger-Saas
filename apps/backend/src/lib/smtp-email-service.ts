import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailParams, EmailSendResult, EmailTransport } from './email-types';

class SMTPEmailService implements EmailTransport {
  private transporter: Transporter | null = null;
  private isConfigured: boolean = false;
  private lastSendAt: string | null = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn('SMTP not configured. Email notifications will be disabled.');
      console.warn('Required environment variables: SMTP_HOST, SMTP_USER, SMTP_PASS');
      this.isConfigured = false;
      return;
    }

    try {
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const smtpSecure = process.env.SMTP_SECURE === 'true';

      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
      });

      this.isConfigured = true;
      console.log('SMTP Email Service initialized successfully');
      console.log(`   Host: ${smtpHost}`);
      console.log(`   Port: ${smtpPort}`);
      console.log(`   Secure: ${smtpSecure}`);
      console.log(`   User: ${smtpUser}`);
    } catch (error) {
      console.error('Failed to initialize SMTP transporter:', error);
      this.isConfigured = false;
    }
  }

  getProviderName(): string {
    return 'smtp';
  }

  getFromEmail(): string {
    return process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@taskledger.com';
  }

  getLastSendAt(): string | null {
    return this.lastSendAt;
  }

  async sendEmail(params: EmailParams): Promise<EmailSendResult> {
    if (!this.isConfigured || !this.transporter) {
      return {
        success: false,
        errorType: 'email_send_error',
        errorMessage: 'SMTP not configured',
      };
    }

    try {
      const fromEmail = this.getFromEmail();
      const fromName = process.env.SMTP_FROM_NAME || 'Task Ledger';

      const mailOptions: nodemailer.SendMailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
        subject: params.subject,
        text: params.text || '',
        html: params.html || params.text || '',
      };

      if (params.idempotencyKey) {
        mailOptions.headers = {
          'Resend-Idempotency-Key': params.idempotencyKey,
        };
      }

      const info = await this.transporter.sendMail(mailOptions);

      this.lastSendAt = new Date().toISOString();

      console.log('Email sent successfully (SMTP)');
      console.log(`   To: ${mailOptions.to}`);
      console.log(`   Subject: ${params.subject}`);
      console.log(`   Message ID: ${info.messageId}`);

      return { success: true, messageId: info.messageId ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to send email:', error);
      return {
        success: false,
        errorType: 'email_exception',
        errorMessage: message,
      };
    }
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.isConfigured || !this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      console.log('SMTP connection verified successfully');
      return true;
    } catch (error) {
      console.error('SMTP connection verification failed:', error);
      return false;
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  async shutdown(): Promise<void> {
    try {
      if (this.transporter) {
        this.transporter.close();
      }
    } finally {
      this.transporter = null;
      this.isConfigured = false;
    }
  }
}

export const smtpEmailService = new SMTPEmailService();

export async function sendEmailSMTP(params: EmailParams): Promise<boolean> {
  const result = await smtpEmailService.sendEmail(params);
  return result.success;
}
