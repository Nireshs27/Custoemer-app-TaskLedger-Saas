import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileX } from "lucide-react";

type TaskLedgerDocumentViewerProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  mimeType: string;
  signedUrl: string;
};

export function TaskLedgerDocumentViewer({
  open,
  onOpenChange,
  title,
  mimeType,
  signedUrl,
}: TaskLedgerDocumentViewerProps) {
  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType.startsWith("image/");
  const canPreview = isPdf || isImage;

  const handleOpenInNewTab = () => {
    window.open(signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold truncate pr-4">{title}</DialogTitle>
            {canPreview && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenInNewTab}
                className="flex-shrink-0"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in New Tab
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {isPdf && (
            <iframe
              src={signedUrl}
              className="w-full h-[calc(90vh-120px)] rounded-md border"
              title={title}
            />
          )}

          {isImage && (
            <div className="flex items-center justify-center h-[calc(90vh-120px)] bg-muted/30 rounded-md border">
              <img
                src={signedUrl}
                alt={title}
                className="max-h-full max-w-full object-contain rounded-md"
              />
            </div>
          )}

          {!canPreview && (
            <div className="flex flex-col items-center justify-center h-[calc(90vh-120px)] bg-muted/30 rounded-md border text-center p-8">
              <FileX className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Preview not available</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This file type ({mimeType}) cannot be previewed in the browser.
              </p>
              <Button onClick={handleOpenInNewTab} variant="outline">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in New Tab
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
