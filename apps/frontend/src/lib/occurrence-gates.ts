export function canCompleteOccurrence(nowMs: number, taskDateUtcIso: string): boolean {
  if (!taskDateUtcIso) return false;
  const target = new Date(taskDateUtcIso).getTime();
  if (Number.isNaN(target)) return false;
  return nowMs > target;
}

