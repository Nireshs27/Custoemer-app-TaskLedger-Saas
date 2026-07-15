import 'dotenv/config';
import crypto from 'node:crypto';
import pg from 'pg';
import { makeOccurrenceKey, toLocalYmdIST } from '../server/storage.ts';
import { runReminderSchedulerOnce } from '../server/reminder-scheduler.ts';
import { shutdownStorage } from '../server/storage.ts';

const WAIT_MINUTES = 5;
const POLL_INTERVAL_MS = 30_000;
const MAX_WAIT_MS = (WAIT_MINUTES + 3) * 60_000;

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const sslDisabled = /sslmode=disable|ssl=false/i.test(cs);
const pool = new pg.Pool({ connectionString: cs, ssl: sslDisabled ? false : { rejectUnauthorized: false }, max: 2 });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const userRes = await pool.query(
    `SELECT id, email, full_name FROM taskledger_users WHERE is_active = true ORDER BY last_login DESC NULLS LAST LIMIT 1`
  );
  const user = userRes.rows[0];
  if (!user?.email) {
    console.error('No active user with email found');
    process.exit(1);
  }

  const now = new Date();
  const reminderAt = new Date(now.getTime() + WAIT_MINUTES * 60_000);
  const occurrenceTaskUtc = new Date(reminderAt.getTime() + 24 * 60 * 60_000); // due tomorrow
  const entityId = crypto.randomUUID();
  const occurrenceKey = makeOccurrenceKey(entityId, occurrenceTaskUtc);
  const recipientEmail = user.email;

  const recipientStatus = {
    [recipientEmail]: {
      status: 'pending',
      attempts: 0,
      last_attempt_at: null,
      last_error: null,
      message_id: null,
      next_retry_at: reminderAt.toISOString(),
    },
  };

  const insert = await pool.query(
    `INSERT INTO occurrence_reminders (
      user_id, entity_type, entity_id, occurrence_task_utc, occurrence_key,
      task_status, due_date_local_ymd, reminder_at_utc, reminder_channel,
      recipient_status, task_title
    ) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,'email',$8,$9)
    RETURNING id, reminder_at_utc, task_title`,
    [
      user.id,
      'task_action',
      entityId,
      occurrenceTaskUtc.toISOString(),
      occurrenceKey,
      toLocalYmdIST(occurrenceTaskUtc),
      reminderAt.toISOString(),
      JSON.stringify(recipientStatus),
      `[TEST] Reminder E2E — ${now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    ]
  );

  const row = insert.rows[0];
  console.log('✅ Test reminder inserted');
  console.log('   id:', row.id);
  console.log('   title:', row.task_title);
  console.log('   recipient:', recipientEmail);
  console.log('   reminder_at_utc:', row.reminder_at_utc);
  console.log(`\n⏳ Waiting ${WAIT_MINUTES} minutes for reminder to become due...`);
  console.log('   (in-process cron on localhost runs every minute)\n');

  const dueAt = reminderAt.getTime();
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const statusRes = await pool.query(
      `SELECT recipient_status, reminder_at_utc FROM occurrence_reminders WHERE id = $1`,
      [row.id]
    );
    const st = statusRes.rows[0]?.recipient_status?.[recipientEmail];
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (st?.status === 'sent') {
      console.log(`\n🎉 SUCCESS after ${elapsed}s — reminder email sent!`);
      console.log('   message_id:', st.message_id);
      console.log('   attempts:', st.attempts);
      await pool.end();
      await shutdownStorage();
      process.exit(0);
    }

    if (st?.status === 'failed') {
      console.log(`\n❌ FAILED after ${elapsed}s`);
      console.log('   error:', st.last_error);
      await pool.end();
      await shutdownStorage();
      process.exit(1);
    }

    const untilDue = Math.max(0, Math.round((dueAt - Date.now()) / 1000));
    console.log(`[${elapsed}s] status=${st?.status ?? 'unknown'} | due in ${untilDue}s`);

    if (Date.now() >= dueAt) {
      console.log('   → due time reached, triggering scheduler once...');
      await runReminderSchedulerOnce();
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.log('\n❌ TIMEOUT — reminder not sent within window');
  await pool.end();
  await shutdownStorage();
  process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => {});
  process.exit(1);
});
