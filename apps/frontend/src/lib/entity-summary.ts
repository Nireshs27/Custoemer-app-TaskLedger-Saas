import { AlertTriangle, Calendar as CalendarIcon, CheckCircle, Clock } from "lucide-react";
import { getEffectiveDueDate } from "./effective-due-date";
import { toISTYmd, classifyYmdStatus } from "./ymd-status";

export type SummaryItem = {
  status?: string | null;
  dueDate?: string | Date | null;
  nextDueDate?: string | Date | null;
  isRecurring?: boolean | null;
  title?: string | null;
  notes?: string | null;
};

export type SummaryResult<T extends SummaryItem = SummaryItem> = {
  itemsCount: number;
  pendingCount: number;
  overdueCount: number;
  dueTodayCount: number;
  upcomingCount: number;
  nextDueItem: T | null;
};

export function buildSummary<T extends SummaryItem = SummaryItem>(
  items: T[],
  opts?: { todayYmd?: string }
): SummaryResult<T> {
  const itemsCount = items.length;
  const pendingItems = items.filter((item) => item.status === "pending");

  const todayYmd = opts?.todayYmd ?? toISTYmd(new Date());

  const pendingWithEffective = pendingItems
    .map((item) => ({ item, eff: getEffectiveDueDate(item) }))
    .filter(({ eff }) => eff !== null) as Array<{ item: T; eff: Date }>;

  const next = pendingWithEffective.sort(
    (a, b) => a.eff.getTime() - b.eff.getTime()
  )[0];

  const nextDueItem = next
    ? ({ ...next.item, dueDate: next.eff } as T)
    : null;

  let overdueCount = 0;
  let dueTodayCount = 0;
  let upcomingCount = 0;

  for (const { eff } of pendingWithEffective) {
    const dueYmd = toISTYmd(eff);
    const status = classifyYmdStatus(dueYmd, todayYmd);
    
    if (status === "overdue") {
      overdueCount++;
    } else if (status === "today") {
      dueTodayCount++;
    } else {
      upcomingCount++;
    }
  }

  const pendingCount = overdueCount + dueTodayCount + upcomingCount;

  return {
    itemsCount,
    pendingCount,
    overdueCount,
    dueTodayCount,
    upcomingCount,
    nextDueItem,
  };
}

export type SummaryStatus = {
  icon: typeof AlertTriangle;
  color: string;
  text: string;
  priority: "high" | "medium" | "low";
};

export function getSummaryStatus(summary: SummaryResult): SummaryStatus {
  if (summary.overdueCount > 0) {
    return {
      icon: AlertTriangle,
      color: "text-red-600 bg-red-50",
      text: `Overdue (${summary.overdueCount})`,
      priority: "high",
    };
  }

  if (summary.dueTodayCount > 0) {
    return {
      icon: Clock,
      color: "text-orange-600 bg-orange-50",
      text: `Due Today (${summary.dueTodayCount})`,
      priority: "medium",
    };
  }

  if (summary.upcomingCount > 0) {
    return {
      icon: CalendarIcon,
      color: "text-blue-600 bg-blue-50",
      text: `Upcoming (${summary.upcomingCount})`,
      priority: "low",
    };
  }

  return {
    icon: CheckCircle,
    color: "text-green-600 bg-green-50",
    text: "Up to Date",
    priority: "low",
  };
}

