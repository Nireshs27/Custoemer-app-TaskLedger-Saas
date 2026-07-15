import { emailTransport } from './lib/email-transport';

interface EmailConfig {
  fromEmail: string;
  fromName: string;
}

interface EmailData {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
}

export class EmailService {
  private config: EmailConfig;

  // Test-only override for sendReminderEmail (no production impact)
  // eslint-disable-next-line @typescript-eslint/ban-types
  private static sendReminderEmailOverride:
    | null
    | ((to: string, userName: string, items: Array<{ title: string; dueDate: string; category: string; daysRemaining: number }>) => Promise<boolean>)
    | null = null;

  /**
   * Test-only hook: override sendReminderEmail behavior.
   * Pass null to clear. Has no effect in production code paths.
   */
  static __setSendReminderEmailForTests(
    fn: null | ((to: string, userName: string, items: Array<{ title: string; dueDate: string; category: string; daysRemaining: number }>) => Promise<boolean>)
  ): void {
    EmailService.sendReminderEmailOverride = fn;
  }

  constructor() {
    this.config = {
      fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || "noreply@taskledger.com",
      fromName: process.env.SMTP_FROM_NAME || "Task Ledger",
    };
  }

  async sendEmail({ to, subject, text, html, idempotencyKey }: EmailData): Promise<boolean> {
    try {
      if (!emailTransport.isReady()) {
        console.warn("Email provider not configured. Email not sent.");
        console.warn("Set EMAIL_PROVIDER=resend + RESEND_API_KEY, or SMTP_* variables.");
        return false;
      }

      const result = await emailTransport.sendEmail({ to, subject, text, html, idempotencyKey });
      return result.success;
    } catch (error) {
      console.error("Error sending email:", error);
      return false;
    }
  }

  async sendReminderEmail(userEmail: string, userName: string, items: Array<{
    title: string;
    dueDate: string;
    category: string;
    daysRemaining: number;
  }>, options?: { idempotencyKey?: string }): Promise<{ success: boolean; messageId?: string | null; errorType?: string; errorMessage?: string }> {
    // Test override (no network)
    if (EmailService.sendReminderEmailOverride) {
      const success = await EmailService.sendReminderEmailOverride(userEmail, userName, items);
      return { success };
    }
    // In test env with no override, short-circuit success to avoid SMTP
    if (process.env.NODE_ENV === "test") {
      return { success: true };
    }

    const overdueItems = items.filter(item => item.daysRemaining < 0);
    const upcomingItems = items.filter(item => item.daysRemaining >= 0);

    let subject = "Task Ledger - ";
    if (overdueItems.length > 0) {
      subject += `${overdueItems.length} Overdue Item${overdueItems.length > 1 ? 's' : ''}`;
      if (upcomingItems.length > 0) {
        subject += ` & ${upcomingItems.length} Upcoming Item${upcomingItems.length > 1 ? 's' : ''}`;
      }
    } else {
      subject += `${upcomingItems.length} Upcoming Item${upcomingItems.length > 1 ? 's' : ''}`;
    }

    const text = this.generateReminderText(userName, overdueItems, upcomingItems);
    const html = this.generateReminderHtml(userName, overdueItems, upcomingItems);

    try {
      if (!emailTransport.isReady()) {
        return { success: false, errorType: 'email_send_error', errorMessage: 'Email provider not configured' };
      }
      const result = await emailTransport.sendEmail({
        to: userEmail,
        subject,
        text,
        html,
        idempotencyKey: options?.idempotencyKey,
      });
      return {
        success: result.success,
        messageId: result.messageId,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
      };
    } catch (error) {
      console.error("Error sending reminder email:", error);
      return {
        success: false,
        errorType: 'email_exception',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private generateReminderText(userName: string, overdueItems: any[], upcomingItems: any[]): string {
    let text = `Dear ${userName},\n\n`;

    if (overdueItems.length > 0) {
      text += `URGENT: You have ${overdueItems.length} overdue item${overdueItems.length > 1 ? 's' : ''}:\n\n`;
      overdueItems.forEach(item => {
        const daysOverdue = Math.abs(item.daysRemaining);
        text += `• ${item.title} (${item.category}) - Due: ${item.dueDate} (${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue)\n`;
      });
      text += "\n";
    }

    if (upcomingItems.length > 0) {
      text += `You also have ${upcomingItems.length} upcoming item${upcomingItems.length > 1 ? 's' : ''}:\n\n`;
      upcomingItems.forEach(item => {
        text += `• ${item.title} (${item.category}) - Due: ${item.dueDate} (${item.daysRemaining} day${item.daysRemaining > 1 ? 's' : ''} remaining)\n`;
      });
      text += "\n";
    }

    text += "Please log in to Task Ledger to manage these items.\n\n";
    text += "Best regards,\nTask Ledger Team";

    return text;
  }

  private getItemStatus(daysRemaining: number): 'pending' | 'overdue' | 'completed' {
    if (daysRemaining < 0) return 'overdue';
    return 'pending';
  }

  private getStatusColors(status: 'pending' | 'overdue' | 'completed'): {
    bgColor: string;
    borderColor: string;
    accentColor: string;
    pillBg: string;
  } {
    const colorMap = {
      pending: {
        bgColor: '#FFFEF5',
        borderColor: '#FEF3C7',
        accentColor: '#FABF50',
        pillBg: '#FEF3C7',
      },
      overdue: {
        bgColor: '#FEF2F2',
        borderColor: '#FECACA',
        accentColor: '#DC2626',
        pillBg: '#FEE2E2',
      },
      completed: {
        bgColor: '#ECFDF5',
        borderColor: '#A7F3D0',
        accentColor: '#058A77',
        pillBg: '#D1FAE5',
      },
    };
    return colorMap[status];
  }

  private generateReminderHtml(userName: string, overdueItems: any[], upcomingItems: any[]): string {
    const allItems = [...overdueItems, ...upcomingItems];
    const totalCount = allItems.length;
    const itemsLabel = totalCount === 1 ? 'Upcoming Item' : 'Upcoming Items';
    
    const dashboardUrl = process.env.APP_BASE_URL || 'https://taskledger.com';
    const notificationSettingsUrl = `${dashboardUrl}/settings/notifications`;
    const currentYear = new Date().getFullYear();
    const generatedAt = new Date().toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Generate items HTML
    const itemsHtml = allItems.map(item => {
      const status = this.getItemStatus(item.daysRemaining);
      const colors = this.getStatusColors(status);
      const absdays = Math.abs(item.daysRemaining);
      const relativeText = status === 'overdue' 
        ? `${absdays} day${absdays !== 1 ? 's' : ''} overdue`
        : `${item.daysRemaining} day${item.daysRemaining !== 1 ? 's' : ''} remaining`;
      
      const statusText = status === 'overdue' ? 'OVERDUE' : 'PENDING';
      const vehicleHtml = item.vehicle ? `
                          <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#7D6B75;font-size:12px;margin-top:6px;font-weight:600;">
                            Vehicle: ${item.vehicle}
                          </div>` : '';
      
      const notesHtml = item.notes ? `
                          <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#7D6B75;font-size:12px;margin-top:8px;font-weight:500;line-height:1.6;">
                            ${item.notes}
                          </div>` : '';

    return `
          <tr>
            <td class="px" style="padding:16px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px; background: ${colors.bgColor}; border:1px solid ${colors.borderColor}; box-shadow:0 2px 8px rgba(1,2,28,0.06);">
                <tr>
                  <td style="padding:18px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="stack" style="vertical-align:top;">
                          <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;font-weight:700;color:#010100;font-size:14px;line-height:1.4;">
                            ${item.title} <span style="font-weight:600;color:#7D6B75;">(${item.category})</span>
                          </div>${vehicleHtml}
                          <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#010100;font-size:13px;margin-top:8px;font-weight:600;">
                            Due: <strong>${item.dueDate}</strong>
                            — <span style="color:${colors.accentColor};font-weight:700;">${relativeText}</span>
                          </div>${notesHtml}
                        </td>
                        <td class="stack" align="right" style="vertical-align:top; white-space:nowrap;">
                          <span style="display:inline-block;padding:6px 12px;border-radius:9999px;background:${colors.pillBg};color:${colors.accentColor};font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">
                            ${statusText}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
    }).join('');

    return `<!doctype html>
<html lang="en">
        <head>
  <meta charset="utf-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Task Ledger Reminder</title>
          <style>
    @media (max-width:600px){
      .container{width:100% !important; border-radius:0 !important;}
      .px{padding-left:20px !important; padding-right:20px !important;}
      .stack{display:block !important; width:100% !important;}
      .center{ text-align:center !important; }
      .btn{ 
        display:block !important; 
        width:100% !important; 
        max-width:100% !important;
        box-sizing:border-box !important;
        text-align:center !important;
      }
      .btn-container{
        padding-left:20px !important;
        padding-right:20px !important;
      }
    }
    :root {
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }
          </style>
        </head>
<body style="margin:0;padding:0;background:#f5f7fb;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:#f5f7fb;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px;max-width:600px;background:#ffffff;border-radius:32px;box-shadow:0 8px 24px rgba(1,2,28,.12);overflow:hidden;">
          <tr>
            <td style="background:#01021C;padding:32px 24px;text-align:center;">
              <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#ffffff;font-size:28px;line-height:1.2;font-weight:700;letter-spacing:-0.5px;">
                Task Ledger Reminder
            </div>
              <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#D5CFD0;font-size:13px;line-height:1.6;margin-top:8px;font-weight:500;">
                Stay on top of your tasks and obligations
                      </div>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:28px 32px 0 32px;">
              <p style="margin:0;font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#010100;font-size:14px;font-weight:600;">
                Dear ${userName}, 
              </p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:20px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;background:#F2F2F1;">
                <tr>
                  <td style="padding:16px 20px;border-left:4px solid #058A77;">
                    <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#010100;font-weight:700;font-size:14px;">
                      ${totalCount} ${itemsLabel}
                </div>
                    <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#7D6B75;font-size:13px;margin-top:4px;font-weight:500;">
                      Upcoming reminders from Task Ledger
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${itemsHtml}
          <tr>
            <td class="btn-container" align="center" style="padding:24px 28px 0 28px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                href="${dashboardUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="50%"
                fillcolor="#058A77" strokecolor="#058A77">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;font-weight:700;">
                  Open Task Ledger
                </center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-->
              <a class="btn" href="${dashboardUrl}" target="_blank"
                 style="display:inline-block;background:#058A77;color:#ffffff;text-decoration:none;border-radius:24px;padding:14px 32px;font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;font-weight:700;box-shadow:0 4px 16px rgba(5,138,119,0.4);transition:all 0.2s;min-width:200px;box-sizing:border-box;text-align:center;">
                 Open Task Ledger
              </a>
              <!--<![endif]-->
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:20px 32px 0 32px;">
              <p style="margin:0;font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#7D6B75;font-size:13px;line-height:1.6;font-weight:500;">
                Please log in to Task Ledger to manage these items and avoid any penalties.
              </p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:28px 32px 32px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #C1B9BC;">
                <tr>
                  <td style="padding-top:16px;text-align:center;">
                    <div style="font-family:'Montserrat',Arial,'Helvetica Neue',Helvetica,sans-serif;color:#AE999F;font-size:11px;font-weight:600;">
                      Generated on ${generatedAt} • Task Ledger © ${currentYear}
            </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
        </body>
</html>`;
  }
}

export const emailService = new EmailService();

export async function shutdownEmailService(): Promise<void> {
  await emailTransport.shutdown().catch(() => {});
}
