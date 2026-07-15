import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, AlertCircle } from "lucide-react";

interface DocumentPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
  originalName: string;
  mimeType: string;
  getSignedUrl: (documentId: string) => Promise<string>;
}

type LoadState = "loading" | "loaded" | "error";

export function DocumentPreviewModal({
  open,
  onOpenChange,
  documentId,
  originalName,
  mimeType,
  getSignedUrl,
}: DocumentPreviewModalProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  useEffect(() => {
    if (!open || !documentId) return;

    setLoadState("loading");
    setSignedUrl(null);

    getSignedUrl(documentId)
      .then((url) => {
        setSignedUrl(url);
        setLoadState("loaded");
      })
      .catch(() => {
        setLoadState("error");
      });
  }, [open, documentId]);

  const handleDownload = () => {
    if (signedUrl) {
      window.open(signedUrl, "_blank");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="truncate max-w-md" title={originalName}>
              {originalName}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!signedUrl}
              className="ml-4 flex-shrink-0"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden rounded-md bg-muted/30 flex items-center justify-center">
          {loadState === "loading" && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          )}

          {loadState === "error" && (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <AlertCircle className="w-8 h-8" />
              <span className="text-sm">Failed to load preview</span>
            </div>
          )}

          {loadState === "loaded" && signedUrl && isImage && (
            <img
              src={signedUrl}
              alt={originalName}
              className="max-w-full max-h-full object-contain"
              style={{ maxHeight: "calc(90vh - 120px)" }}
            />
          )}

          {loadState === "loaded" && signedUrl && isPdf && (
            <iframe
              src={signedUrl}
              title={originalName}
              className="w-full border-0"
              style={{ height: "calc(90vh - 120px)" }}
            />
          )}

          {loadState === "loaded" && signedUrl && !isImage && !isPdf && (
            <div className="flex flex-col items-center gap-3 text-muted-foreground p-8">
              <span className="text-sm">
                Preview not available for this file type.
              </span>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download to view
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
