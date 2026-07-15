import { useEffect, useRef, useState } from "react";
import { FileText, Image, FileIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentThumbnailProps {
  documentId: string;
  mimeType: string;
  getSignedUrl: (documentId: string) => Promise<string>;
  className?: string;
  onClick?: () => void;
  "data-testid"?: string;
}

type LoadState = "idle" | "loading" | "loaded" | "error";

export function DocumentThumbnail({
  documentId,
  mimeType,
  getSignedUrl,
  className,
  onClick,
  "data-testid": testId,
}: DocumentThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const hasStarted = useRef(false);

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasStarted.current) {
          hasStarted.current = true;
          loadPreview();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [documentId, mimeType]);

  const loadPreview = async () => {
    if (!isImage && !isPdf) return;
    setLoadState("loading");

    try {
      const url = await getSignedUrl(documentId);

      if (isImage) {
        setImgSrc(url);
        setLoadState("loaded");
      } else if (isPdf) {
        await renderPdfThumbnail(url);
      }
    } catch {
      setLoadState("error");
    }
  };

  const renderPdfThumbnail = async (url: string) => {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      // Use the local worker file via Vite's URL import — avoids CDN dependency and
      // works with pdfjs-dist v5 which ships only .mjs workers (no legacy .js on CDN).
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const pdf = await pdfjsLib.getDocument({ url }).promise;
      const page = await pdf.getPage(1);

      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas not mounted");

      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = 192;
      const scale = targetWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      // pdfjs-dist v5 requires `canvas` as a top-level RenderParameters field
      await page.render({ canvas, viewport: scaledViewport }).promise;

      setLoadState("loaded");
    } catch {
      setLoadState("error");
    }
  };

  const FallbackIcon = isPdf ? FileText : isImage ? Image : FileIcon;
  const showFallback = loadState === "idle" || loadState === "error";
  const showSpinner = loadState === "loading";
  const showImg = loadState === "loaded" && isImage && imgSrc;
  // Canvas is always rendered so the ref is available when PDF.js draws into it;
  // visibility is controlled via CSS so the node is never unmounted mid-render.
  const showCanvas = isPdf;

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "w-48 h-64 rounded-md bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden relative",
        onClick && "cursor-pointer hover:opacity-80 transition-opacity",
        className
      )}
    >
      {/* Always mount canvas for PDFs so the ref is live when render() is called */}
      {showCanvas && (
        <canvas
          ref={canvasRef}
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            loadState === "loaded" ? "opacity-100" : "opacity-0"
          )}
          style={{ display: "block" }}
        />
      )}

      {showImg && (
        <img
          src={imgSrc}
          alt="Document preview"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {showSpinner && (
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin z-10" />
      )}

      {showFallback && (
        <FallbackIcon className="w-6 h-6 text-muted-foreground z-10" />
      )}
    </div>
  );
}
