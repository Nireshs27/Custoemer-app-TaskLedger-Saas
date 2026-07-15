import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FileText, Download, Calendar, FileIcon, Eye, Upload, Users } from "lucide-react";
import { format } from "date-fns";
import { useEntityAttachments, type EntityDocument } from "@/hooks/useEntityAttachments";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TaskLedgerDocumentViewer } from "@/components/documents/TaskLedgerDocumentViewer";
import { AttachmentsModal } from "@/components/modals/attachments-modal";
import { useQuery } from "@tanstack/react-query";

type EntityOverviewModalProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entityType: "property" | "vehicle" | "asset" | "task_action" | "tax_legal_compliance" | "tax_item" | "vehicle_item" | "asset_item" | "task_action_item" | "tax_legal_item";
  entityId: string;
  entityLabel: string;
  entitySummary: Record<string, any>;
};

export function EntityOverviewModal({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityLabel,
  entitySummary,
}: EntityOverviewModalProps) {
  const { toast } = useToast();
  const { data: documents = [], isLoading: documentsLoading } = useEntityAttachments({
    entityType,
    entityId,
    enabled: open,
  });

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ["/api/hr-employees"],
    enabled: open,
  });

  const employeeMap = useMemo(() => {
    const map = new Map<string, any>();
    employees.forEach((emp) => map.set(emp.id, emp));
    return map;
  }, [employees]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewDoc, setPreviewDoc] = useState<EntityDocument | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [showAttachments, setShowAttachments] = useState(false);

  const handleDownload = async (doc: EntityDocument) => {
    try {
      const data = await apiRequest("GET", `/api/task-ledger-documents/${doc.id}/signed-url`);
      if (data.url) {
        window.open(data.url, "_blank");
      }
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Failed to get download URL",
        variant: "destructive",
      });
    }
  };

  const handlePreview = async (doc: EntityDocument) => {
    setLoadingPreview(doc.id);
    try {
      const data = await apiRequest("GET", `/api/task-ledger-documents/${doc.id}/preview-url`);
      if (data.signedUrl) {
        setPreviewUrl(data.signedUrl);
        setPreviewDoc(doc);
        setPreviewOpen(true);
      }
    } catch (error) {
      toast({
        title: "Preview failed",
        description: error instanceof Error ? error.message : "Failed to get preview URL",
        variant: "destructive",
      });
    } finally {
      setLoadingPreview(null);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes("pdf")) return "📄";
    if (mimeType.includes("image")) return "🖼️";
    if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
    if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "📊";
    return "📎";
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Prevent modal interactions from triggering card onClick
  const handleOutsideInteraction = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        data-entity-modal="overview"
        onPointerDownOutside={handleOutsideInteraction}
        onInteractOutside={handleOutsideInteraction}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{entityLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Entity Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(entitySummary)
                .filter(([key, value]) => value !== null && value !== undefined && value !== "")
                .map(([key, value]) => (
                  <div key={key} className="flex justify-between items-start py-1">
                    <span className="text-sm font-medium text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </span>
                    <span className="text-sm text-right max-w-md">
                      {key === "assignees" && Array.isArray(value) ? (
                        <div className="flex flex-col items-end gap-2">
                          {value.length > 0 ? (
                            value.map((a: any) => {
                              const employee = employeeMap.get(a.id);
                              return (
                                <div key={a.id} className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{a.name}</span>
                                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border border-border">
                                    {employee?.photoUrl ? (
                                      <img
                                        src={employee.photoUrl}
                                        alt={a.name}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <span className="text-[10px] font-medium">
                                        {a.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <span className="text-muted-foreground italic">None assigned</span>
                          )}
                        </div>
                      ) : key === "link" && typeof value === "string" && value.trim() !== "" ? (
                        <a
                          href={value.startsWith("http") ? value : `https://${value}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline underline-offset-2 hover:opacity-80 break-all"
                        >
                          {value}
                        </a>
                      ) : typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : value instanceof Date
                        ? format(value, "MMM d, yyyy")
                        : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </span>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Separator />

          {/* Attachments Section */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Attachments ({documents.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAttachments(true)}
                className="h-8 gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                Attach
              </Button>
            </CardHeader>
            <CardContent>
              {documentsLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  Loading attachments...
                </div>
              ) : documents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No attachments found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-2xl flex-shrink-0">{getFileIcon(doc.mimeType)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.originalName}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span>{formatFileSize(doc.sizeBytes)}</span>
                            {doc.documentType && (
                              <>
                                <span>•</span>
                                <Badge variant="outline" className="text-xs px-1.5 py-0">
                                  {doc.documentType.replace(/_/g, " ")}
                                </Badge>
                              </>
                            )}
                            {doc.createdAt && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {format(new Date(doc.createdAt), "MMM d, yyyy")}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePreview(doc)}
                          disabled={loadingPreview === doc.id}
                          title="Preview"
                        >
                          {loadingPreview === doc.id ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(doc)}
                          title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>

      {/* Preview Modal */}
      {previewDoc && (
        <TaskLedgerDocumentViewer
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={previewDoc.originalName}
          mimeType={previewDoc.mimeType}
          signedUrl={previewUrl}
        />
      )}

      {showAttachments && (
        <AttachmentsModal
          open={showAttachments}
          onOpenChange={setShowAttachments}
          entityType={entityType}
          entityId={entityId}
          entityLabel={entityLabel}
        />
      )}
    </Dialog>
  );
}
