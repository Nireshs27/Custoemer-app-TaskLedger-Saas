import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import DocumentUploadModal from "@/components/modals/document-upload-modal";
import { DocumentThumbnail } from "./DocumentThumbnail";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import {
  Upload,
  MoreVertical,
  Download,
  Trash2,
  FileUp,
  Loader2,
  Eye,
  FolderDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  getCachedSignedUrl,
  setCachedSignedUrl,
  clearCachedSignedUrl,
} from "@/lib/signedUrlCache";

interface TaskLedgerDocument {
  id: string;
  orgId: string;
  bucketKey: string;
  originalName: string;
  fileName: string | null;
  mimeType: string;
  sizeBytes: number | null;
  createdBy: string;
  createdAt: string;
  documentType: string | null;
  linkId: string;
}

interface PropertyDocumentsTabProps {
  propertyId: string;
  propertyName: string;
}

async function fetchSignedUrl(documentId: string): Promise<string> {
  const cached = getCachedSignedUrl(documentId);
  if (cached) return cached;

  const data = await apiRequest("GET", `/api/task-ledger-documents/${documentId}/signed-url`);
  if (!data.url) throw new Error("No URL returned");

  setCachedSignedUrl(documentId, data.url);
  return data.url;
}

export default function PropertyDocumentsTab({ propertyId, propertyName }: PropertyDocumentsTabProps) {
  const { toast } = useToast();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [deletingDocument, setDeletingDocument] = useState<TaskLedgerDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<TaskLedgerDocument | null>(null);

  const { data: documents, isLoading } = useQuery<TaskLedgerDocument[]>({
    queryKey: [`/api/task-ledger-documents`, { entityType: 'property', entityId: propertyId }],
    queryFn: async () => {
      return await apiRequest(
        'GET',
        `/api/task-ledger-documents?entityType=property&entityId=${propertyId}`
      );
    },
    enabled: !!propertyId,
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      await apiRequest("DELETE", `/api/task-ledger-documents/${documentId}`);
    },
    onSuccess: (_data, documentId) => {
      clearCachedSignedUrl(documentId);
      queryClient.invalidateQueries({
        queryKey: [`/api/task-ledger-documents`, { entityType: 'property', entityId: propertyId }]
      });
      toast({ title: "Document deleted successfully" });
      setDeletingDocument(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete document",
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const getDocumentTypeColor = (type: string | null) => {
    if (!type) return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300';
    const colors: Record<string, string> = {
      'tax_receipt': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      'property_document': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      'insurance_policy': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      'license_certificate': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
      'maintenance_record': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300';
  };

  const formatDocumentType = (type: string | null) => {
    if (!type) return 'Document';
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleDownload = async (document: TaskLedgerDocument) => {
    setDownloadingId(document.id);
    try {
      const url = await fetchSignedUrl(document.id);
      window.open(url, '_blank');
    } catch (error) {
      toast({
        title: "Failed to download",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (isDownloadingAll || propertyDocuments.length < 2) return;
    setIsDownloadingAll(true);
    try {
      const BATCH_SIZE = 50;
      const allIds = propertyDocuments.map((d) => d.id);
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
      toast({
        title: "Download all failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingAll(false);
    }
  };

  const handleView = (document: TaskLedgerDocument) => {
    setPreviewDocument(document);
  };

  const handleDelete = (document: TaskLedgerDocument) => {
    setDeletingDocument(document);
  };

  const confirmDelete = () => {
    if (deletingDocument) {
      deleteDocumentMutation.mutate(deletingDocument.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const propertyDocuments = documents || [];

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Documents</h3>
          <Badge variant="secondary" className="text-xs">
            {propertyDocuments.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {propertyDocuments.length >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
              data-testid="button-download-all-documents"
            >
              {isDownloadingAll ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FolderDown className="w-4 h-4 mr-2" />
              )}
              Download All
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setShowUploadModal(true)}
            data-testid="button-upload-document"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload Document
          </Button>
        </div>
      </div>

      {/* Documents list */}
      {propertyDocuments.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <FileUp className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h4 className="text-lg font-medium mb-2">No documents uploaded yet</h4>
          <p className="text-muted-foreground mb-4">
            Upload documents related to {propertyName}
          </p>
          <Button onClick={() => setShowUploadModal(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Document
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {propertyDocuments.map((document) => {
            const isDownloading = downloadingId === document.id;

            return (
              <div
                key={document.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                data-testid={`document-row-${document.id}`}
              >
                {/* Thumbnail */}
                <DocumentThumbnail
                  documentId={document.id}
                  mimeType={document.mimeType}
                  getSignedUrl={fetchSignedUrl}
                  onClick={() => handleView(document)}
                  data-testid={`document-thumbnail-${document.id}`}
                />

                {/* Metadata */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate" title={document.originalName}>
                    {document.originalName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] px-1.5 py-0", getDocumentTypeColor(document.documentType))}
                    >
                      {formatDocumentType(document.documentType)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(document.createdAt), { addSuffix: true })}
                    </span>
                    {document.sizeBytes && (
                      <span className="text-xs text-muted-foreground">
                        • {(document.sizeBytes / 1024 / 1024).toFixed(2)} MB
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      data-testid={`document-actions-${document.id}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleView(document)}
                      data-testid={`document-view-${document.id}`}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDownload(document)}
                      disabled={isDownloading}
                      data-testid={`document-download-${document.id}`}
                    >
                      {isDownloading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Download
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(document)}
                      className="text-destructive focus:text-destructive"
                      data-testid={`document-delete-${document.id}`}
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

      {/* Upload Document Modal */}
      <DocumentUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        entityType="property"
        entityId={propertyId}
        lockEntitySelection={true}
        entityDisplayName={propertyName}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingDocument} onOpenChange={() => setDeletingDocument(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingDocument?.originalName}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
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
