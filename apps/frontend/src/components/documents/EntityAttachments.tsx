import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ObjectUploader, type ObjectUploaderHandle } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Upload, MoreVertical, Download, Eye, Trash2, Loader2, FileUp, FolderDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DocumentThumbnail } from "@/components/property/DocumentThumbnail";
import { DocumentPreviewModal } from "@/components/property/DocumentPreviewModal";
import { getUploadParameters, useDocumentSaveMutation } from "@/components/documents/useTaskLedgerDocumentUpload";
import { cn } from "@/lib/utils";

type EntityAttachmentsProps = {
  entityType: "property" | "vehicle" | "asset" | "task_action" | "tax_legal_compliance" | "tax_item" | "vehicle_item" | "asset_item" | "task_action_item" | "tax_legal_item";
  entityId?: string;
  entityLabel?: string;
  disabled?: boolean;
};

type EntityDocument = {
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

const documentTypes = [
  "Tax Receipt",
  "GST Return",
  "Income Tax Document",
  "License Certificate",
  "Insurance Policy",
  "Vehicle Registration",
  "Property Document",
  "Asset Receipt",
  "Maintenance Record",
  "Other",
];

async function fetchSignedUrl(documentId: string): Promise<string> {
  const data = await apiRequest("GET", `/api/task-ledger-documents/${documentId}/signed-url`);
  if (!data.url) throw new Error("No URL returned");
  return data.url;
}

const getDocumentTypeColor = (type: string | null) => {
  if (!type) return "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300";
  const colors: Record<string, string> = {
    tax_receipt: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    property_document: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    insurance_policy: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    license_certificate: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    maintenance_record: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  };
  return colors[type] || "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300";
};

const formatDocumentType = (type: string | null) => {
  if (!type) return "Document";
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export function EntityAttachments({
  entityType,
  entityId,
  entityLabel,
  disabled = false,
}: EntityAttachmentsProps) {
  const { toast } = useToast();
  const uploaderRef = useRef<ObjectUploaderHandle>(null);
  const [selectedDocType, setSelectedDocType] = useState("other");
  const [isUploading, setIsUploading] = useState(false);
  const [filesQueued, setFilesQueued] = useState(0);
  const [previewDocument, setPreviewDocument] = useState<EntityDocument | null>(null);
  const [deletingDocument, setDeletingDocument] = useState<EntityDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);

  const { data: documents = [], isLoading } = useQuery<EntityDocument[]>({
    queryKey: ["/api/task-ledger-documents", { entityType, entityId }],
    queryFn: async () => {
      return await apiRequest("GET", `/api/task-ledger-documents?entityType=${entityType}&entityId=${entityId}`);
    },
    enabled: !!entityType && !!entityId,
  });

  const removeLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      return await apiRequest("DELETE", `/api/task-ledger-document-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-ledger-documents", { entityType, entityId }] });
      toast({ title: "Attachment removed" });
      setDeletingDocument(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove attachment", description: error.message, variant: "destructive" });
    },
  });

  const saveDocumentMutation = useDocumentSaveMutation();

  const handleUpload = async () => {
    if (!entityType || !entityId) {
      toast({ title: "Entity information is missing", variant: "destructive" });
      return;
    }
    if (!uploaderRef.current) {
      toast({ title: "Uploader not initialized", variant: "destructive" });
      return;
    }
    const queuedFiles = uploaderRef.current.getFiles();
    if (queuedFiles.length === 0) {
      toast({ title: "Please select a file first", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const result = await uploaderRef.current.upload();
      if (!result.successful || result.successful.length === 0) {
        toast({ title: "Upload failed", description: "No files were uploaded successfully", variant: "destructive" });
        setIsUploading(false);
        return;
      }
      for (const file of result.successful) {
        await saveDocumentMutation.mutateAsync({
          entityType,
          entityId,
          documentType: selectedDocType,
          bucketKey: file.bucketKey,
          mimeType: file.type,
          sizeBytes: file.size,
          originalName: file.name,
        });
      }
      toast({ title: `${result.successful.length} document(s) uploaded successfully` });
      uploaderRef.current.reset();
      setFilesQueued(0);
      setSelectedDocType("other");
    } catch (error) {
      toast({ title: "Upload failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = async (doc: EntityDocument) => {
    setDownloadingId(doc.id);
    try {
      const url = await fetchSignedUrl(doc.id);
      window.open(url, "_blank");
    } catch (error) {
      toast({ title: "Download failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (isDownloadingAll || documents.length < 2) return;
    setIsDownloadingAll(true);
    try {
      const BATCH_SIZE = 50;
      const allIds = documents.map((d) => d.id);
      const batches: string[][] = [];
      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        batches.push(allIds.slice(i, i + BATCH_SIZE));
      }
      const allResults: { documentId: string; url: string | null; originalName: string | null }[] = [];
      for (const batch of batches) {
        const data = await apiRequest("POST", "/api/task-ledger-documents/bulk-signed-urls", {
          documentIds: batch,
        });
        allResults.push(...(data.results as { documentId: string; url: string | null; originalName: string | null }[]));
      }
      const successful = allResults.filter((r) => r.url);
      if (successful.length === 0) {
        toast({ title: "No files could be downloaded", variant: "destructive" });
        return;
      }
      for (let i = 0; i < successful.length; i++) {
        const r = successful[i];
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            const a = window.document.createElement("a");
            a.href = r.url!;
            a.download = r.originalName || "document";
            a.target = "_blank";
            window.document.body.appendChild(a);
            a.click();
            window.document.body.removeChild(a);
            resolve();
          }, i * 300);
        });
      }
      toast({ title: `Downloading ${successful.length} file${successful.length !== 1 ? "s" : ""}` });
    } catch (error) {
      toast({ title: "Download all failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const confirmDelete = () => {
    if (deletingDocument) {
      removeLinkMutation.mutate(deletingDocument.linkId);
    }
  };

  if (!entityId) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Attachments</Label>
        <p className="text-sm text-muted-foreground">Save this record to enable attachments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Attachments</Label>
          {documents.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {documents.length}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {documents.length >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
              className="h-7 px-2 text-xs"
            >
              {isDownloadingAll ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <FolderDown className="h-3 w-3 mr-1" />
              )}
              Download All
            </Button>
          )}
          {entityLabel && (
            <p className="text-xs text-muted-foreground">Linked to {entityLabel}</p>
          )}
        </div>
      </div>

      {/* Documents list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-8 border rounded-lg bg-muted/30">
          <FileUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No attachments yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const isDownloading = downloadingId === doc.id;
            return (
              <div
                key={doc.linkId}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
              >
                {/* Thumbnail */}
                <DocumentThumbnail
                  documentId={doc.id}
                  mimeType={doc.mimeType}
                  getSignedUrl={fetchSignedUrl}
                  onClick={() => !disabled && setPreviewDocument(doc)}
                />

                {/* Metadata */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate" title={doc.originalName}>
                    {doc.originalName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] px-1.5 py-0", getDocumentTypeColor(doc.documentType))}
                    >
                      {formatDocumentType(doc.documentType)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                    </span>
                    {doc.sizeBytes && (
                      <span className="text-xs text-muted-foreground">
                        • {(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB
                      </span>
                    )}
                  </div>
                </div>

                {/* Three-dot actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={disabled}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setPreviewDocument(doc)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDownload(doc)}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeletingDocument(doc)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload section */}
      <div className="border-t pt-4 space-y-4">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm font-medium">Upload Document</Label>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Document Type</Label>
          <Select
            value={selectedDocType}
            onValueChange={setSelectedDocType}
            disabled={disabled || isUploading}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {documentTypes.map((type) => (
                <SelectItem key={type} value={type.toLowerCase().replace(/\s+/g, "_")}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ObjectUploader
          ref={uploaderRef}
          maxNumberOfFiles={5}
          maxFileSize={10485760}
          onGetUploadParameters={(file) => getUploadParameters(entityType!, entityId!, file)}
          onFilesChange={setFilesQueued}
        />

        <Button
          onClick={handleUpload}
          disabled={disabled || isUploading || filesQueued === 0}
          className="w-full"
          size="lg"
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading...
            </>
          ) : (
            `Upload ${filesQueued > 0 ? `(${filesQueued})` : ""}`
          )}
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingDocument} onOpenChange={() => setDeletingDocument(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Attachment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{deletingDocument?.originalName}"? This will unlink the document from this record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Document Preview Modal */}
      <DocumentPreviewModal
        open={!!previewDocument}
        onOpenChange={(open) => { if (!open) setPreviewDocument(null); }}
        documentId={previewDocument?.id ?? null}
        originalName={previewDocument?.originalName ?? ""}
        mimeType={previewDocument?.mimeType ?? ""}
        getSignedUrl={fetchSignedUrl}
      />
    </div>
  );
}
