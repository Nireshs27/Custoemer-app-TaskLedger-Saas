import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AnimatedSection } from "@/components/ui/animated-section";
import {
  Server,
  Database,
  Globe,
  Clock,
  Mail,
  HelpCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";

/* ────────────────────────────────────────────────────────
   Reusable premium section card  (DRY — used 3×)
   ──────────────────────────────────────────────────────── */

interface SectionCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  children: ReactNode;
  delay?: number;
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  delay = 0,
}: SectionCardProps) {
  return (
    <AnimatedSection delay={delay}>
      <Card className="group relative rounded-2xl border border-border/60 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-lg hover:shadow-black/[0.04] hover:-translate-y-0.5 hover:border-border transition-all duration-300 overflow-hidden">
        {/* Hover glow ring */}
        <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none ring-1 ring-inset ring-amber-200/20" />

        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-50 text-amber-700 border border-amber-200/60 shadow-sm group-hover:bg-amber-100/80 group-hover:scale-[1.06] transition-all duration-300">
              <Icon className="w-[18px] h-[18px]" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold tracking-tight">
                {title}
              </CardTitle>
              <CardDescription className="text-[13px] mt-0.5">
                {description}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>{children}</CardContent>
      </Card>
    </AnimatedSection>
  );
}

/* ────────────────────────────────────────────────────────
   Background decoration  (gradient blobs + dot grid)
   ──────────────────────────────────────────────────────── */

function BackgroundDecoration() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {/* Warm gradient blobs with subtle parallax drift */}
      <motion.div
        className="absolute -top-32 right-0 w-[420px] h-[420px] rounded-full bg-gradient-to-br from-amber-100/30 to-orange-50/10 blur-3xl"
        animate={shouldReduceMotion ? {} : { x: [0, 12, 0], y: [0, -10, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/2 -left-32 w-[360px] h-[360px] rounded-full bg-gradient-to-tr from-amber-50/25 to-yellow-50/10 blur-3xl"
        animate={shouldReduceMotion ? {} : { x: [0, -10, 0], y: [0, 14, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Subtle dot-grid overlay (industrial texture) */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(0,0,0,0.03) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   Settings page
   ──────────────────────────────────────────────────────── */

export function SettingsPage() {
  const appVersion = "1.0.0";
  const environment = import.meta.env.MODE || "development";

  return (
    <div className="relative min-h-[calc(100vh-4rem)]">
      <BackgroundDecoration />

      <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 max-w-4xl">
        <div className="space-y-7">
          {/* ── Hero Section ──────────────────────────────── */}
          <AnimatedSection>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6">
              <div className="space-y-1.5">
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight bg-gradient-to-r from-gray-900 via-gray-800 to-gray-600 bg-clip-text text-transparent">
                  Settings
                </h1>
                <p className="text-muted-foreground text-[15px] max-w-md leading-relaxed">
                  Manage your application configuration and view system
                  information
                </p>
              </div>

              {/* System-status mini-card */}
              <AnimatedSection delay={0.12} className="shrink-0">
                <div className="inline-flex flex-col items-start sm:items-end gap-1.5">
                  <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-white/70 backdrop-blur-sm border border-border/50 shadow-sm">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="text-sm font-medium text-gray-700">
                      System Operational
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground/70 sm:pr-1 tabular-nums">
                    v{appVersion} &middot;{" "}
                    <span className="capitalize">{environment}</span>
                  </span>
                </div>
              </AnimatedSection>
            </div>
          </AnimatedSection>

          {/* ── SMTP Configuration ────────────────────────── */}
          <SectionCard
            icon={Mail}
            title="SMTP Configuration"
            description="Configure email server settings for reminder notifications"
            delay={0.08}
          >
            <div className="bg-muted/40 p-4 rounded-xl border border-border/40">
              <p className="text-sm text-muted-foreground leading-relaxed">
                SMTP configuration is managed by system administrators. Contact
                your admin to update email server settings.
              </p>
            </div>
          </SectionCard>

          {/* ── Technical Information ─────────────────────── */}
          <SectionCard
            icon={Server}
            title="Technical Information"
            description="System details and environment configuration"
            delay={0.16}
          >
            <div className="divide-y divide-border/50">
              {(
                [
                  { icon: Globe, label: "Application Name", value: "Task Ledger" },
                  { icon: Server, label: "Version", value: appVersion },
                  { icon: Server, label: "Environment", value: environment, capitalize: true },
                  { icon: Database, label: "Database", value: "PostgreSQL" },
                  { icon: Clock, label: "Timezone Handling", value: "UTC stored, Local displayed" },
                ] as const
              ).map(({ icon: RowIcon, label, value, ...rest }) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0 group/row"
                >
                  <div className="flex items-center gap-2.5">
                    <RowIcon className="w-4 h-4 text-muted-foreground/60 group-hover/row:text-amber-600/70 transition-colors duration-200" />
                    <span className="text-sm font-medium text-gray-700">
                      {label}
                    </span>
                  </div>
                  <span
                    className={`text-sm text-muted-foreground tabular-nums ${
                      "capitalize" in rest && rest.capitalize
                        ? "capitalize"
                        : ""
                    }`}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Help & Documentation ──────────────────────── */}
          <SectionCard
            icon={HelpCircle}
            title="Help & Documentation"
            description="Learn how to use Task Ledger effectively"
            delay={0.24}
          >
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="what-is">
                <AccordionTrigger>What is Task Ledger?</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Task Ledger is a comprehensive task and reminder
                      management system designed to help you track:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Tax and legal compliance deadlines</li>
                      <li>Vehicle maintenance and renewal tasks</li>
                      <li>Asset management activities</li>
                      <li>Property-related obligations</li>
                      <li>General task actions and workflows</li>
                    </ul>
                    <p className="mt-2">
                      All tasks can be configured with automated email reminders
                      to ensure you never miss important deadlines.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="reminders">
                <AccordionTrigger>How Reminders Work</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Reminders are automatically generated for all tasks based
                      on your configuration:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>
                        <strong>Reminder Offset:</strong> Set how many
                        days/hours before the due date you want to be reminded
                      </li>
                      <li>
                        <strong>Reminder Time:</strong> Choose the time of day
                        you prefer to receive reminders (e.g., 09:00)
                      </li>
                      <li>
                        <strong>Email Delivery:</strong> Reminders are sent via
                        email at the scheduled time
                      </li>
                      <li>
                        <strong>Multiple Recipients:</strong> Add multiple email
                        addresses to notify your team
                      </li>
                    </ul>
                    <p className="mt-2">
                      All reminder times are stored in UTC but displayed in your
                      local timezone throughout the application.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="recurring">
                <AccordionTrigger>
                  Recurring Tasks: After vs Never
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      When creating recurring tasks, you can choose how they
                      end:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>
                        <strong>After X occurrences:</strong> The task will
                        repeat a specific number of times (max 200). Each
                        occurrence has its own due date and reminder schedule.
                      </li>
                      <li>
                        <strong>Never (Indefinite):</strong> The task repeats
                        indefinitely. The system generates up to 200 future
                        occurrences at a time for performance reasons.
                      </li>
                      <li>
                        <strong>On Date:</strong> The task repeats until a
                        specific end date.
                      </li>
                    </ul>
                    <p className="mt-2">
                      <strong>Note:</strong> The 200 occurrence limit applies to
                      all recurring tasks to ensure optimal system performance.
                      For "Never" tasks, new occurrences are automatically
                      generated as older ones are completed.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="occurrence-status">
                <AccordionTrigger>
                  Occurrence Status & Mark Complete
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Each task occurrence has its own status that can be
                      tracked independently:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>
                        <strong>Pending:</strong> Task is not yet complete
                      </li>
                      <li>
                        <strong>Completed:</strong> Task has been marked as done
                      </li>
                      <li>
                        <strong>Skipped:</strong> Task was intentionally skipped
                      </li>
                    </ul>
                    <p className="mt-2">
                      <strong>Completing Tasks:</strong>
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>
                        Click "Mark Complete" on any task occurrence to mark it
                        as done
                      </li>
                      <li>The status updates immediately in the UI</li>
                      <li>
                        Completed occurrences show a green "Completed" badge
                      </li>
                      <li>
                        You can only complete tasks on or after their due date
                      </li>
                      <li>
                        For recurring tasks, completing one occurrence doesn't
                        affect others
                      </li>
                    </ul>
                    <p className="mt-2">
                      All completion data is stored in the database and
                      preserved across sessions.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="smtp-troubleshooting">
                <AccordionTrigger>
                  Troubleshooting SMTP / Email Issues
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      If you're not receiving reminder emails, check the
                      following:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>
                        <strong>SMTP Configuration:</strong> Verify your email
                        server settings are correct (contact admin)
                      </li>
                      <li>
                        <strong>Spam Folder:</strong> Check if emails are being
                        filtered as spam
                      </li>
                      <li>
                        <strong>Email Address:</strong> Ensure the recipient
                        email addresses are entered correctly
                      </li>
                      <li>
                        <strong>Reminder Schedule:</strong> Verify the reminder
                        offset and time are set properly
                      </li>
                      <li>
                        <strong>Missed Reminders:</strong> Check the
                        notifications icon in the header for failed email
                        deliveries
                      </li>
                    </ul>
                    <p className="mt-2">
                      <strong>System Administrator Access:</strong> SMTP
                      settings can only be configured by system administrators
                      to ensure security and proper email delivery.
                    </p>
                    <p className="mt-2">
                      <strong>Delivery Status:</strong> The system tracks email
                      delivery status. If emails fail to send, you'll see a
                      notification badge in the header that you can click to
                      view details.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
