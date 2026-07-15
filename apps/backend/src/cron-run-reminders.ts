import "dotenv/config";
import { runReminderSchedulerOnce } from "./reminder-scheduler";
import { shutdownEmailService } from "./emailService";
import { shutdownStorage } from "./storage";

async function shutdownAll() {
  await shutdownEmailService().catch(() => {});
  await shutdownStorage().catch(() => {});
}

async function main() {
  await runReminderSchedulerOnce();
}

main()
  .then(async () => {
    await shutdownAll();
    console.log("[cron] done, exiting");
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Reminder processing cron failed", error);
    await shutdownAll();
    process.exit(1);
  });

