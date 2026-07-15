import { AlertTriangle, Loader2, MailWarning, Mail, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMissedReminders, type MissedReminderDTO } from "@/hooks/useMissedReminders";
import { formatUtcToIstDisplay } from "@/lib/datetime";
import { useLocation } from "wouter";

const scheduleLabelMap: Record<string, string> = {
  one_time: "One-time",
  finite: "Recurring (finite)",
  infinite: "Recurring",
};

export default function MissedReminderInboxPage() {
  const {
    data: missed = [],
    isLoading,
    isError,
    refetch,
    markAsRead,
  } = useMissedReminders();
  const [, setLocation] = useLocation();

  const renderHeaderCard = () => (
    <Card className="rounded-xl shadow-occurrence px-6">
      <CardContent className="p-6 sm:p-6 flex flex-col gap-2">
        <div>
          <h1 className="text-2xl font-bold">Missed reminder emails</h1>
          <p className="text-muted-foreground">
            These reminder emails failed to send. The system will retry automatically,
            but you can review and follow up here.
          </p>
        </div>
        {missed.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="px-3 py-1 rounded-full">
              {missed.length} open {missed.length === 1 ? "issue" : "issues"}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary hover:text-primary"
              onClick={() => setLocation("/task-actions")}
            >
              Open Task Actions
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6">
        {renderHeaderCard()}
        <Card className="rounded-xl">
          <CardContent className="py-12 text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Loading missed reminders...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6">
        {renderHeaderCard()}
        <Card className="rounded-xl border border-destructive/40">
          <CardContent className="py-12 text-center space-y-4">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
            <div>
              <p className="font-semibold">Unable to load missed reminders</p>
              <p className="text-muted-foreground text-sm">
                There was a problem fetching reminder history. Please try again.
              </p>
            </div>
            <Button variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 max-w-screen-2xl space-y-6">
      {renderHeaderCard()}

      {missed.length === 0 ? (
        <Card className="rounded-xl border border-green-200 bg-green-50/40">
          <CardContent className="py-12 text-center space-y-4">
            <MailWarning className="h-10 w-10 text-green-600 mx-auto" />
            <div>
              <p className="font-semibold text-lg">No missed reminders 🎉</p>
              <p className="text-muted-foreground text-sm">
                All reminder emails have been delivered successfully.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-white border rounded-2xl p-6 shadow-sm">
          <div className="space-y-3">
            {missed.map((reminder) => (
              <MissedReminderRow
                key={`${reminder.reminderId}-${reminder.occurrenceNumber}-${reminder.recipientEmail}`}
                reminder={reminder}
                onMarkAsRead={markAsRead}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MissedReminderRow({
  reminder,
  onMarkAsRead,
}: {
  reminder: MissedReminderDTO;
  onMarkAsRead: (item: MissedReminderDTO) => void;
}) {
  const plannedLabel = reminder.reminderDateUtc
    ? formatUtcToIstDisplay(reminder.reminderDateUtc)
    : "—";
  const attemptedLabel = reminder.attemptedAtUtc
    ? formatUtcToIstDisplay(reminder.attemptedAtUtc)
    : "—";
  const scheduleLabel =
    (reminder.scheduleType &&
      scheduleLabelMap[reminder.scheduleType as keyof typeof scheduleLabelMap]) ||
    "Scheduled reminder";

  return (
    <div 
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-white border rounded-2xl hover:shadow-sm transition-shadow"
      data-testid={`missed-reminder-${reminder.reminderId}-${reminder.recipientEmail}`}
    >
      <div className="flex items-center space-x-4 flex-1 min-w-0 w-full">
        {/* Left Icon */}
        <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center flex-shrink-0">
          <Mail className="w-5 h-5 text-red-600" />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Title and Recipient */}
          <h4 className="font-medium text-foreground truncate">
            {reminder.taskTitle ?? "Reminder"}
          </h4>
          <div className="text-sm text-muted-foreground space-y-0.5">
            <p className="truncate">
              To: <span className="font-medium text-foreground">{reminder.recipientEmail}</span>
              {reminder.entityType && <span className="mx-1">•</span>}
              {reminder.entityType && <span>{reminder.entityType}</span>}
              {scheduleLabel && <span className="mx-1">•</span>}
              {scheduleLabel && <span>Occurrence #{reminder.occurrenceNumber}</span>}
            </p>
            {/* Planned and Last Attempt Times */}
            <p className="text-xs">
              {plannedLabel && plannedLabel !== "—" && (
                <>
                  <span className="font-medium">Planned:</span> {plannedLabel}
                </>
              )}
              {attemptedLabel !== "—" && (
                <>
                  {plannedLabel && plannedLabel !== "—" && <span className="mx-2">•</span>}
                  <span className="font-medium">Last attempt:</span> {attemptedLabel}
                </>
              )}
            </p>
            {/* Error Message */}
            {reminder.errorMessage && (
              <p className="text-xs text-red-600 mt-1">
                {reminder.errorMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Right Side - Badge and Action */}
      <div className="flex items-center gap-3 flex-shrink-0 sm:ml-4 w-full sm:w-auto justify-end">
        <Badge 
          variant="destructive" 
          className="uppercase text-xs font-semibold"
          data-testid={`badge-status-${reminder.reminderId}`}
        >
          Failed
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onMarkAsRead(reminder)}
          className="text-muted-foreground hover:text-primary text-xs flex items-center gap-1.5 min-h-[44px]"
          data-testid={`button-mark-read-${reminder.reminderId}`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Mark as read
        </Button>
      </div>
    </div>
  );
}
