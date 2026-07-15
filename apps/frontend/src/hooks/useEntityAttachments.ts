import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type EntityDocument = {
  id: string;
  orgId: string;
  bucketKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
  documentType: string | null;
  linkId: string;
};

type UseEntityAttachmentsParams = {
  entityType: string;
  entityId: string;
  enabled?: boolean;
};

export function useEntityAttachments({ entityType, entityId, enabled = true }: UseEntityAttachmentsParams) {
  return useQuery<EntityDocument[]>({
    queryKey: ["/api/task-ledger-documents", { entityType, entityId }],
    queryFn: async () => {
      return await apiRequest("GET", `/api/task-ledger-documents?entityType=${entityType}&entityId=${entityId}`);
    },
    enabled: enabled && !!entityType && !!entityId,
  });
}
