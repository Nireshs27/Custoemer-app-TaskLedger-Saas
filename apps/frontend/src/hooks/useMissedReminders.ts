import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type MissedReminderDTO = {
  reminderId: string;
  occurrenceNumber: number;
  recipientEmail: string;
  userId: string;
  entityType: string;
  entityId: string;
  taskTitle: string | null;
  taskCategory: string | null;
  scheduleType: string | null;
  reminderDateUtc: string | null;
  attemptedAtUtc: string | null;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  emailSubject: string | null;
  acknowledgedByUser?: boolean;
};

type MissedRemindersResponse = {
  missedReminders: MissedReminderDTO[];
};

const DISMISSED_MISSED_REMINDERS_KEY =
  "taskledger.dismissedMissedReminders";

const loadDismissedKeys = (): Set<string> => {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const stored = window.localStorage.getItem(
      DISMISSED_MISSED_REMINDERS_KEY
    );
    if (!stored) {
      return new Set();
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    return new Set();
  }
};

const persistDismissedKeys = (keys: Set<string>) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    DISMISSED_MISSED_REMINDERS_KEY,
    JSON.stringify(Array.from(keys))
  );
};

export const getMissedReminderKey = (item: MissedReminderDTO): string =>
  `${item.reminderId}:${item.occurrenceNumber}:${item.recipientEmail.toLowerCase()}`;

export function useMissedReminders() {
  const queryClient = useQueryClient();
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(
    () => loadDismissedKeys()
  );

  const queryResult = useQuery({
    queryKey: ["missed-reminders"],
    queryFn: async (): Promise<MissedReminderDTO[]> => {
      const res = await apiRequest<MissedRemindersResponse>(
        "GET",
        "/api/reminders/missed"
      );
      return res.missedReminders ?? [];
    },
    staleTime: 60_000,
  });

  const filteredData = useMemo(
    () =>
      (queryResult.data ?? []).filter(
        (item) => !dismissedKeys.has(getMissedReminderKey(item))
      ),
    [queryResult.data, dismissedKeys]
  );

  const markAsRead = useCallback(
    (item: MissedReminderDTO) => {
      const key = getMissedReminderKey(item);
      setDismissedKeys((prev) => {
        if (prev.has(key)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(key);
        persistDismissedKeys(next);
        queryClient.setQueryData<MissedReminderDTO[]>(
          ["missed-reminders"],
          (old) =>
            (old ?? []).filter(
              (row) => getMissedReminderKey(row) !== key
            )
        );
        return next;
      });

      // ⭐ NEW: Use occurrence_reminders API endpoint
      void apiRequest<{ ok: boolean; updatedRecipients: string[] }>(
        "POST",
        `/api/reminders/occurrence/${item.reminderId}/mark-expired`,
        {
          recipientKeys: [item.recipientEmail],
        }
      ).catch(() => {
        // backend failure will surface on the next refetch; no-op here
      });
    },
    [queryClient]
  );

  return {
    ...queryResult,
    data: filteredData,
    markAsRead,
  };
}
