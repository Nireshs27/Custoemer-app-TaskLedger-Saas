import { BellRing } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMissedReminders } from "@/hooks/useMissedReminders";
import { useLocation } from "wouter";

export function MissedReminderBadge() {
  const { data: missed = [] } = useMissedReminders();
  const [, setLocation] = useLocation();
  const count = missed.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setLocation("/missed-reminders")}
          className="relative flex items-center justify-center w-12 h-12 rounded-lg transition-all duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
          data-testid="missed-reminders-badge"
        >
          <BellRing className="w-5 h-5 text-white" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 text-[10px] font-bold text-[#FFC857] leading-none">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="text-xs font-normal"
        style={{
          backgroundColor: "#ffffff",
          color: "#010100",
          borderRadius: "12px",
          border: "none",
          boxShadow: "0 4px 12px rgba(1, 2, 28, 0.15)",
        }}
      >
        {count > 0
          ? `${count} missed ${count === 1 ? "reminder" : "reminders"}`
          : "No missed reminders"}
      </TooltipContent>
    </Tooltip>
  );
}
