import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * Shared upload logic for Task Ledger documents.
 * Used by both DocumentUploadModal and EntityAttachments (Attach Documents modal).
 */

export type EntityType = "property" | "vehicle" | "asset" | "task_action" | "tax_legal_compliance";

export interface UploadParameters {
  method: "PUT";
  url: string;
  bucketKey: string;
  headers: Record<string, string>;
}

export interface DocumentSaveData {
  entityType: string;
  entityId: string;
  documentType: string;
  bucketKey: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

/**
 * Gets upload parameters for a file from the backend.
 * This calls the storage service to generate a signed URL for upload.
 */
export async function getUploadParameters(
  entityType: string,
  entityId: string,
  file: { name: string; type: string; size: number }
): Promise<UploadParameters> {
  if (!entityType || !entityId) {
    throw new Error("Entity type and ID are required for upload");
  }

  const data = await apiRequest("POST", "/api/task-ledger-objects/upload", {
    entityType,
    entityId,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });

  const headers: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
  };

  if (data.token) {
    headers["Authorization"] = `Bearer ${data.token}`;
  }

  return {
    method: "PUT" as const,
    url: data.uploadURL,
    bucketKey: data.bucketKey,
    headers,
  };
}

/**
 * Hook for saving document metadata to the database after successful upload.
 * Automatically invalidates the documents query for the given entity.
 * 
 * Note: Error handling should be done by the caller in their try-catch block
 * for custom error messages.
 */
export function useDocumentSaveMutation() {
  return useMutation({
    mutationFn: async (data: DocumentSaveData) => {
      return await apiRequest("POST", "/api/task-ledger-documents", data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/task-ledger-documents", { entityType: variables.entityType, entityId: variables.entityId }],
      });
    },
  });
}

/**
 * Manually invalidate documents query for a specific entity.
 * Useful when you need to refresh the list outside of the mutation callback.
 */
export function invalidateDocumentsQuery(entityType: string, entityId: string) {
  queryClient.invalidateQueries({
    queryKey: ["/api/task-ledger-documents", { entityType, entityId }],
  });
}
