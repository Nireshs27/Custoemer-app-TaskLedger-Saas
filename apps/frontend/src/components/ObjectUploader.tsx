import { forwardRef, useImperativeHandle, useRef, useState, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, Upload, FileText, CloudUpload } from "lucide-react";
import { useSingleFileDialogTrigger } from "@/hooks/use-single-file-dialog-trigger";

interface FileInfo {
  name: string;
  type: string;
  size: number;
}

export interface ObjectUploaderHandle {
  upload: () => Promise<{ successful: Array<{ name: string; type: string; size: number; bucketKey: string }> }>;
  getFiles: () => File[];
  reset: () => void;
}

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: (file: FileInfo) => Promise<{
    method: "PUT";
    url: string;
    bucketKey: string;
    headers?: Record<string, string>;
  }>;
  onFilesChange?: (count: number) => void;
  buttonClassName?: string;
  children?: React.ReactNode;
}

export const ObjectUploader = forwardRef<ObjectUploaderHandle, ObjectUploaderProps>(
  ({ maxNumberOfFiles = 1, maxFileSize = 10485760, onGetUploadParameters, onFilesChange, buttonClassName, children }, ref) => {
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isDragActive, setIsDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputId = useId();
    const triggerFileDialog = useSingleFileDialogTrigger();

    useImperativeHandle(ref, () => ({
      upload: async () => {
        const successful: Array<{ name: string; type: string; size: number; bucketKey: string }> = [];

        for (const file of selectedFiles) {
          try {
            // Get upload parameters
            const params = await onGetUploadParameters({
              name: file.name,
              type: file.type,
              size: file.size,
            });

            // Upload file to signed URL
            const uploadResponse = await fetch(params.url, {
              method: params.method,
              headers: params.headers || {},
              body: file,
            });

            if (!uploadResponse.ok) {
              throw new Error(`Upload failed: ${uploadResponse.statusText}`);
            }

            successful.push({
              name: file.name,
              type: file.type,
              size: file.size,
              bucketKey: params.bucketKey,
            });
          } catch (error) {
            console.error(`Failed to upload ${file.name}:`, error);
            throw error;
          }
        }

        return { successful };
      },

      getFiles: () => {
        return selectedFiles;
      },

      reset: () => {
        setSelectedFiles([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      },
    }), [selectedFiles, onGetUploadParameters]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      
      // Validate file count
      if (files.length > maxNumberOfFiles) {
        alert(`You can only select up to ${maxNumberOfFiles} file(s)`);
        return;
      }

      // Validate file sizes
      const oversizedFiles = files.filter(f => f.size > maxFileSize);
      if (oversizedFiles.length > 0) {
        alert(`Some files exceed the maximum size of ${(maxFileSize / 1024 / 1024).toFixed(0)}MB`);
        return;
      }

      setSelectedFiles(files);
      onFilesChange?.(files.length);
    };

    const removeFile = (index: number) => {
      setSelectedFiles(prev => {
        const newFiles = prev.filter((_, i) => i !== index);
        onFilesChange?.(newFiles.length);
        return newFiles;
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    const handleDragEnter = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(true);
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget === e.target) {
        setIsDragActive(false);
      }
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      
      // Validate file count
      if (droppedFiles.length > maxNumberOfFiles) {
        alert(`You can only select up to ${maxNumberOfFiles} file(s)`);
        return;
      }

      // Validate file sizes
      const oversizedFiles = droppedFiles.filter(f => f.size > maxFileSize);
      if (oversizedFiles.length > 0) {
        alert(`Some files exceed the maximum size of ${(maxFileSize / 1024 / 1024).toFixed(0)}MB`);
        return;
      }

      // Inject files into hidden input
      if (fileInputRef.current && droppedFiles.length > 0) {
        const dataTransfer = new DataTransfer();
        droppedFiles.forEach(file => dataTransfer.items.add(file));
        fileInputRef.current.files = dataTransfer.files;
        
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        fileInputRef.current.dispatchEvent(event);
      }
    };

    const formatFileSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    return (
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple={maxNumberOfFiles > 1}
          onChange={handleFileSelect}
          className="hidden"
          id={inputId}
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        />
        
        {selectedFiles.length === 0 ? (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                <CloudUpload className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold">Upload files</h3>
                <p className="text-sm text-muted-foreground">Select and upload the files of your choice</p>
              </div>
            </div>

            {/* Dropzone Card */}
            <div
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => triggerFileDialog(fileInputRef)}
              className={cn(
                "relative cursor-pointer rounded-2xl border-2 border-dashed transition-colors",
                isDragActive 
                  ? "border-primary bg-primary/5" 
                  : "border-border hover:border-primary/50 hover:bg-accent/50"
              )}
            >
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="mb-4 flex items-center justify-center w-12 h-12 rounded-full bg-accent">
                  <Upload className="w-6 h-6 text-muted-foreground" />
                </div>
                
                <p className="mb-2 text-sm font-medium">
                  Choose a file or drag & drop it here
                </p>
                
                <p className="mb-4 text-xs text-muted-foreground">
                  PDF, JPG, PNG, DOC, DOCX formats, up to {(maxFileSize / 1024 / 1024).toFixed(0)}MB
                </p>
                
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerFileDialog(fileInputRef);
                  }}
                >
                  Browse File
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header with file count */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {selectedFiles.length} {selectedFiles.length === 1 ? 'file' : 'files'} selected
                </span>
              </div>
              {selectedFiles.length < maxNumberOfFiles && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => triggerFileDialog(fileInputRef)}
                  className="text-xs"
                >
                  Add More
                </Button>
              )}
            </div>

            {/* File List */}
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
);

ObjectUploader.displayName = "ObjectUploader";
