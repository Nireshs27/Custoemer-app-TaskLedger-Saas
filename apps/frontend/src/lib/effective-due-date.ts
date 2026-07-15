export function getEffectiveDueDate(item: {
  dueDate?: string | Date | null;
  nextDueDate?: string | Date | null;
  isRecurring?: boolean | null;
}): Date | null {
  const parse = (v: any): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const anyItem = item as any;
  const isRecurring =
    Boolean(item.isRecurring) ||
    Boolean(anyItem.is_recurring) ||
    Boolean(anyItem.recurrenceData) ||
    Boolean(anyItem.recurrence_data);

  const nextRaw = anyItem.nextDueDate ?? anyItem.next_due_date;
  const dueRaw = anyItem.dueDate ?? anyItem.due_date;

  if (isRecurring) {
    const next = parse(nextRaw);
    if (next) return next;
    return parse(dueRaw);
  }

  return parse(dueRaw);
}

