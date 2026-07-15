import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';
import { runReminderSchedulerOnce } from '../server/reminder-scheduler.ts';
import { shutdownStorage } from '../server/storage.ts';
import { shutdownEmailService } from '../server/emailService.ts';

const RECIPIENT = process.env.TEST_REMINDER_EMAIL || 'system.kck@gmail.com';

const cs = process.env.DATABASE_URL;
const sslDisabled = cs ? /sslmode=disable|ssl=false/i.test(cs) : false;
const pool = new pg.Pool({
  connectionString: cs,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: 2,
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const userRes = await pool.query(
    `SELECT id, full_name FROM taskledger_users WHERE username = 'Management' LIMIT 1`
  );
  const user = userRes.rows[0];
  if (!user) {
    console.error('Management user not found');
    process.exit(1);
  }

  const now = new Date();
  const reminderAt = new Date(now.getTime() - 30_000); // 30s ago — due immediately
  const occurrenceTaskUtc = new Date(now.getTime() + 24 * 60 * 60_000);
  const entityId = crypto.randomUUID();
  const occurrenceKey = `${entityId}:${occurrenceTaskUtc.toISOString()}`;

  const recipientStatus = {
    [RECIPIENT]: {
      status: 'pending',
      attempts: 0,
      last_attempt_at: null,
      last_error: null,
      message_id: null,
      next_retry_at: reminderAt.toISOString(),
    },
  };

  const dueYmd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const insert = await pool.query(
    `INSERT INTO occurrence_reminders (
      user_id, entity_type, entity_id, occurrence_task_utc, occurrence_key,
      task_status, due_date_local_ymd, reminder_at_utc, reminder_channel,
      recipient_status, task_title
    ) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,'email',$8,$9)
    RETURNING id, task_title, reminder_at_utc`,
    [
      user.id,
      'vehicle_item',
      entityId,
      occurrenceTaskUtc.toISOString(),
      occurrenceKey,
      dueYmd,
      reminderAt.toISOString(),
      JSON.stringify(recipientStatus),
      `[VERIFY Resend] Reminder test ${now.toISOString()}`,
    ]
  );

  const row = insert.rows[0];
  console.log('Inserted test reminder:', row.id);
  console.log('Recipient:', RECIPIENT);
  console.log('Running scheduler once...\n');

  await runReminderSchedulerOnce();

  for (let i = 0; i < 6; i++) {
    const st = await pool.query(
      `SELECT recipient_status FROM occurrence_reminders WHERE id = $1`,
      [row.id]
    );
    const status = st.rows[0]?.recipient_status?.[RECIPIENT];
    console.log(`Poll ${i + 1}: status=${status?.status ?? 'unknown'} message_id=${status?.message_id ?? 'null'} error=${status?.last_error ?? 'null'}`);

    if (status?.status === 'sent') {
      console.log('\nSUCCESS: Reminder email sent via Resend');
      console.log('Message ID:', status.message_id);
      await pool.end();
      await shutdownEmailService();
      await shutdownStorage();
      process.exit(0);
    }
    if (status?.status === 'failed') {
      console.error('\nFAILED:', status.last_error);
      await pool.end();
      await shutdownEmailService();
      await shutdownStorage();
      process.exit(1);
    }
    await sleep(5000);
    if (i < 5) await runReminderSchedulerOnce();
  }

  console.error('\nTIMEOUT: reminder not sent within 30s');
  await pool.end();
  await shutdownEmailService();
  await shutdownStorage();
  process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  await shutdownEmailService().catch(() => {});
  await shutdownStorage().catch(() => {});
  process.exit(1);
});
