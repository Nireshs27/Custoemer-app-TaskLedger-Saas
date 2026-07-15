import { storage } from "./storage";
import { attemptOccurrenceReminderSend } from "./reminder-sender";
import type { RecipientStatus } from "@shared/schema";

const MAX_REMINDERS_PER_RUN = 200;
const SCHEDULER_LOCK_NAME = "reminders"; // Stable lease name for scheduler runs
// Lease long enough to cover a full batch of sends, but short enough that a
// crashed run frees the lease quickly for the next minute's run.
const SCHEDULER_LEASE_TTL_SECONDS = 300;

// Helper: check if recipient is eligible to send
function isRecipientEligible(status: RecipientStatus | undefined): boolean {
  if (!status) return true; // Treat missing as pending
  const s = status.status;
  return s === 'pending' || s === 'failed' || !s;
}

function todayYmdIST(d: Date): string {
  const ist = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const day = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function runReminderSchedulerOnce(): Promise<void> {
  // Acquire a self-expiring lease to prevent overlapping runs (pooler-safe).
  const leaseToken = await storage.acquireSchedulerLease(
    SCHEDULER_LOCK_NAME,
    SCHEDULER_LEASE_TTL_SECONDS,
  );
  if (!leaseToken) {
    console.log("⏭️  Another scheduler run is active; exiting.");
    return;
  }

  try {
    console.log("\n🔔 Running occurrence reminder scheduler...");
    
    const pendingRows = await storage.getPendingOccurrenceReminders(MAX_REMINDERS_PER_RUN);

    if (pendingRows.length === 0) {
      console.log("✅ No pending occurrence reminders to process");
      return;
    }

    console.log(`\n⭐ Found ${pendingRows.length} occurrence reminder row(s)...`);

    let totalSent = 0;
    const now = new Date();

    for (const row of pendingRows) {
      if (totalSent >= MAX_REMINDERS_PER_RUN) {
        console.log(`\n⏸️  Reached send limit (${MAX_REMINDERS_PER_RUN}), stopping for this run`);
        break;
      }

      try {
        // Expire only if the reminder itself is more than 72 hours old.
        // This allows late delivery when the server was briefly down while
        // still preventing stale reminders from firing days/weeks later.
        const reminderAtUtc = new Date(row.reminderAtUtc);
        const reminderAgeHours = (now.getTime() - reminderAtUtc.getTime()) / (1000 * 60 * 60);
        if (reminderAgeHours > 72) {
          console.log(`\n⏰ Occurrence expired (reminder >72h old): ${row.taskTitle} (due: ${row.dueDateLocalYmd}, reminder was: ${reminderAtUtc.toISOString()})`);
          await storage.expireOccurrenceReminderRecipients({
            id: row.id,
            nowIso: now.toISOString(),
          });
          continue;
        }

        // Parse recipientStatus JSONB
        const recipientStatus = row.recipientStatus as Record<string, RecipientStatus>;
        
        // Find eligible recipients
        const eligibleRecipients = Object.entries(recipientStatus).filter(
          ([_, status]) => isRecipientEligible(status)
        );

        if (eligibleRecipients.length === 0) {
          continue;
        }

        console.log(`\n📧 Processing: ${row.taskTitle} (${row.reminderChannel})`);
        console.log(`   Due: ${row.dueDateLocalYmd}`);
        console.log(`   Eligible recipients: ${eligibleRecipients.length}`);

        // Get user info
        const user = await storage.getTaskLedgerUser(row.userId);
        if (!user) {
          console.warn(`   ⚠️ Could not load user ${row.userId} - skipping row`);
          continue;
        }

        // Compute daysRemaining
        const occurrenceTaskUtc = new Date(row.occurrenceTaskUtc);
        const daysRemaining = Math.ceil(
          (occurrenceTaskUtc.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        // Build task summary
        const taskSummary = {
          title: row.taskTitle,
          dueDate: row.dueDateLocalYmd,
          category: row.entityType,
          daysRemaining,
        };

        // Send to each eligible recipient
        for (const [recipientKey, recipientStatus] of eligibleRecipients) {
          if (totalSent >= MAX_REMINDERS_PER_RUN) {
            console.log(`   ⏸️  Reached send limit, skipping remaining recipients`);
            break;
          }

          let claimToken: string | null = null;
          try {
            console.log(`   → Sending to ${recipientKey} (attempt ${(recipientStatus?.attempts || 0) + 1})`);

            // Claim this recipient atomically
            const claim = await storage.claimOccurrenceReminderRecipient({
              id: row.id,
              recipientKey,
            });

            if (!claim.ok) {
              console.log(`     ⏭️  Already claimed or sent, skipping`);
              continue;
            }

            claimToken = claim.sendToken;

            // Attempt send
            const result = await attemptOccurrenceReminderSend({
              row,
              recipient: recipientKey,
              channel: row.reminderChannel,
              userName: user.fullName || 'User',
              taskSummary,
            });

            // Finalize with token verification
            await storage.finalizeOccurrenceReminderRecipientAttempt({
              id: row.id,
              recipientKey,
              sendToken: claimToken,
              didSucceed: result.success,
              messageId: result.messageId,
              errorMessage: result.errorMessage,
            });

            if (result.success) {
              console.log(`     ✅ Sent successfully`);
              totalSent++;
            } else {
              console.log(`     ❌ Failed: ${result.errorType} - ${result.errorMessage}`);
            }
          } catch (error) {
            console.error(`     ❌ Error sending to ${recipientKey}:`, error);
            // IMPORTANT: if we claimed, we must finalize to failed (otherwise "sending" sticks)
            if (claimToken) {
              await storage.finalizeOccurrenceReminderRecipientAttempt({
                id: row.id,
                recipientKey,
                sendToken: claimToken,
                didSucceed: false,
                errorMessage: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error processing reminder row ${row.id}:`, error);
      }
    }

    console.log(`\n✅ Occurrence reminder processing complete (sent: ${totalSent})\n`);
  } catch (error) {
    console.error("❌ Fatal error in occurrence reminder scheduler:", error);
  } finally {
    // Always release the lease (only releases if we still own it)
    await storage.releaseSchedulerLease(SCHEDULER_LOCK_NAME, leaseToken);
  }
}

