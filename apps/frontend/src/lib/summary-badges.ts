/**
 * Multi-status badge helper for entity summaries
 * 
 * Shows up to 3 badges simultaneously: Overdue, Due Today, Upcoming
 * Falls back to "Up to Date" if all counts are zero
 */

export type SummaryBadge = {
  key: string;
  label: string;
  variant: 'destructive' | 'secondary' | 'outline' | 'default';
  className?: string;
};

export type SummaryInput = {
  overdueCount?: number;
  dueTodayCount?: number;
  upcomingCount?: number;
};

/**
 * Get array of badges to display for a summary
 * 
 * @param summary - Summary with count fields (missing counts treated as 0)
 * @returns Array of badge configs in priority order: Overdue → Due Today → Upcoming → Up to Date
 */
export function getSummaryBadges(summary: SummaryInput): SummaryBadge[] {
  const overdueCount = summary.overdueCount ?? 0;
  const dueTodayCount = summary.dueTodayCount ?? 0;
  const upcomingCount = summary.upcomingCount ?? 0;

  const badges: SummaryBadge[] = [];

  // Priority order: Overdue → Due Today → Upcoming
  if (overdueCount > 0) {
    badges.push({
      key: 'overdue',
      label: `Overdue (${overdueCount})`,
      variant: 'destructive',
    });
  }

  if (dueTodayCount > 0) {
    badges.push({
      key: 'due-today',
      label: `Due Today (${dueTodayCount})`,
      variant: 'secondary',
      className: 'bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-300',
    });
  }

  if (upcomingCount > 0) {
    badges.push({
      key: 'upcoming',
      label: `Upcoming (${upcomingCount})`,
      variant: 'outline',
      className: 'bg-blue-50 text-blue-700 border-blue-300',
    });
  }

  // Fallback: if all zero, show "Up to Date"
  if (badges.length === 0) {
    badges.push({
      key: 'up-to-date',
      label: 'Up to Date',
      variant: 'outline',
      className: 'bg-green-50 text-green-700 border-green-300',
    });
  }

  return badges;
}

