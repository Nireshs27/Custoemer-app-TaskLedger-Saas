import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ObjectUploader, type ObjectUploaderHandle } from "@/components/ObjectUploader";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { Property, Vehicle, Asset, TaskAction, TaxLegalCompliance } from "@shared/schema";
import { getUploadParameters, useDocumentSaveMutation } from "@/components/documents/useTaskLedgerDocumentUpload";

const ENTITY_TYPE_OPTIONS = [
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'asset', label: 'Asset' },
  { value: 'task_action', label: 'Task Action' },
  { value: 'tax_legal_compliance', label: 'Tax & Legal Compliance' },
  { value: 'vehicle_item', label: 'Vehicle Task' },
  { value: 'asset_item', label: 'Asset Task' },
  { value: 'task_action_item', label: 'Task Action Item' },
  { value: 'tax_legal_item', label: 'Tax & Legal Task' },
] as const;

type EntityType = 'property' | 'vehicle' | 'asset' | 'task_action' | 'tax_legal_compliance' | 'vehicle_item' | 'asset_item' | 'task_action_item' | 'tax_legal_item';

function getEntityDisplayName(entityType: EntityType, entity: any): string {
  if (!entity) return '';
  switch (entityType) {
    case 'property':
      return entity.name || entity.address || 'Unnamed Property';
    case 'vehicle':
      const vehicleName = `${entity.make || ''} ${entity.model || ''}`.trim();
      return entity.registrationNumber 
        ? `${vehicleName} - ${entity.registrationNumber}` 
        : vehicleName || 'Unnamed Vehicle';
    case 'asset':
      return entity.name || entity.assetName || 'Unnamed Asset';
    case 'task_action':
      return entity.title || entity.name || 'Unnamed Task';
    case 'tax_legal_compliance':
      return entity.title || entity.name || 'Unnamed Compliance';
    case 'vehicle_item':
    case 'asset_item':
    case 'task_action_item':
    case 'tax_legal_item':
      return entity.title || entity.description || 'Unnamed Task Item';
    default:
      return entity.name || entity.title || 'Unknown';
  }
}

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType?: EntityType;
  entityId?: string;
  lockEntitySelection?: boolean;
  entityDisplayName?: string;
}

const documentSchema = z.object({
  documentType: z.string().min(1, "Document type is required"),
});

type DocumentFormData = z.infer<typeof documentSchema>;

export default function DocumentUploadModal({ 
  isOpen, 
  onClose,
  entityType: propEntityType,
  entityId: propEntityId,
  lockEntitySelection = false,
  entityDisplayName: propEntityDisplayName,
}: DocumentUploadModalProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const uploaderRef = useRef<ObjectUploaderHandle>(null);
  const uploaderRootRef = useRef<HTMLDivElement>(null);
  
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | ''>('');
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [filesQueued, setFilesQueued] = useState(0);
  const [isDragActive, setIsDragActive] = useState(false);

  const isContextualMode = Boolean(propEntityType && propEntityId && lockEntitySelection);
  
  const entityType = isContextualMode ? propEntityType : (selectedEntityType || undefined);
  const entityId = isContextualMode ? propEntityId : (selectedEntityId || undefined);

  const form = useForm<DocumentFormData>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      documentType: "",
    },
  });

  // Fetch entities for global mode
  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'property',
  });

  const { data: vehicles = [] } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'vehicle',
  });

  const { data: assets = [] } = useQuery<Asset[]>({
    queryKey: ["/api/assets"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'asset',
  });

  const { data: taskActions = [] } = useQuery<TaskAction[]>({
    queryKey: ["/api/task-actions"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'task_action',
  });

  const { data: taxLegalCompliances = [] } = useQuery<TaxLegalCompliance[]>({
    queryKey: ["/api/tax-legal-compliances"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'tax_legal_compliance',
  });


  const { data: vehicleItems = [] } = useQuery<any[]>({
    queryKey: ["/api/vehicle-items"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'vehicle_item',
  });

  const { data: assetItems = [] } = useQuery<any[]>({
    queryKey: ["/api/asset-items"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'asset_item',
  });

  const { data: taskActionItems = [] } = useQuery<any[]>({
    queryKey: ["/api/task-action-items"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'task_action_item',
  });

  const { data: taxLegalItems = [] } = useQuery<any[]>({
    queryKey: ["/api/tax-legal-items"],
    enabled: isOpen && !isContextualMode && selectedEntityType === 'tax_legal_item',
  });

  const entityOptions = useMemo(() => {
    if (!selectedEntityType || isContextualMode) return [];
    
    let entities: any[] = [];
    switch (selectedEntityType) {
      case 'property':
        entities = properties;
        break;
      case 'vehicle':
        entities = vehicles;
        break;
      case 'asset':
        entities = assets;
        break;
      case 'task_action':
        entities = taskActions;
        break;
      case 'tax_legal_compliance':
        entities = taxLegalCompliances;
        break;
      case 'vehicle_item':
        entities = vehicleItems;
        break;
      case 'asset_item':
        entities = assetItems;
        break;
      case 'task_action_item':
        entities = taskActionItems;
        break;
      case 'tax_legal_item':
        entities = taxLegalItems;
        break;
    }
    
    return entities.map(entity => ({
      value: entity.id,
      label: getEntityDisplayName(selectedEntityType, entity),
    }));
  }, [selectedEntityType, isContextualMode, properties, vehicles, assets, taskActions, taxLegalCompliances]);

  const entityDisplayName = useMemo(() => {
    if (isContextualMode) return propEntityDisplayName;
    if (!selectedEntityType || !selectedEntityId) return '';
    
    const option = entityOptions.find(opt => opt.value === selectedEntityId);
    return option?.label || '';
  }, [isContextualMode, propEntityDisplayName, selectedEntityType, selectedEntityId, entityOptions]);

  // Reset files count when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFilesQueued(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedEntityType('');
      setSelectedEntityId('');
      setFilesQueued(0);
      form.reset();
      // Reset uploader
      if (uploaderRef.current) {
        uploaderRef.current.reset();
      }
    }
  }, [isOpen, form]);

  useEffect(() => {
    setSelectedEntityId('');
  }, [selectedEntityType]);

  // Use shared document save mutation from the DRY helper
  const saveDocumentMutation = useDocumentSaveMutation();

  const handleClose = () => {
    if (uploaderRef.current) {
      uploaderRef.current.reset();
    }
    setFilesQueued(0);
    form.reset();
    onClose();
  };

  // Helper: Check if file type is allowed
  const isAllowedFile = (file: File): boolean => {
    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    const fileName = file.name.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    const hasValidMimeType = allowedMimeTypes.includes(file.type);
    
    return hasValidExtension || hasValidMimeType;
  };

  // Helper: Validate dropped files
  const validateDroppedFiles = (files: FileList, currentCount: number) => {
    const accepted: File[] = [];
    const rejectedReasons: string[] = [];
    let truncated = false;

    const maxFiles = 5;
    const maxFileSize = 10485760; // 10MB

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Check if adding this file would exceed max files
      if (accepted.length + currentCount >= maxFiles) {
        truncated = true;
        break;
      }

      // Check file type
      if (!isAllowedFile(file)) {
        rejectedReasons.push(`${file.name}: Invalid file type`);
        continue;
      }

      // Check file size
      if (file.size > maxFileSize) {
        rejectedReasons.push(`${file.name}: Exceeds 10MB limit`);
        continue;
      }

      accepted.push(file);
    }

    return { accepted, rejectedReasons, truncated };
  };

  // Helper: Inject files into ObjectUploader's hidden input
  const injectFilesIntoObjectUploader = (files: File[]) => {
    if (files.length === 0) return;

    // Find the hidden file input inside ObjectUploader
    const fileInput = uploaderRootRef.current?.querySelector('input[type="file"]') as HTMLInputElement | null;
    
    if (!fileInput) {
      console.error('Could not find file input inside ObjectUploader');
      toast({
        title: "Upload failed",
        description: "Unable to process dropped files",
        variant: "destructive"
      });
      return;
    }

    try {
      // Create a DataTransfer to hold the files
      const dataTransfer = new DataTransfer();
      files.forEach(file => dataTransfer.items.add(file));
      
      // Set the files to the input
      fileInput.files = dataTransfer.files;
      
      // Dispatch a change event to trigger ObjectUploader's internal logic
      const changeEvent = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(changeEvent);
    } catch (error) {
      console.error('Error injecting files:', error);
      toast({
        title: "Upload failed",
        description: "Failed to process dropped files",
        variant: "destructive"
      });
    }
  };

  const onSubmit = async (data: DocumentFormData) => {
    console.log("🔵 Upload Document clicked", { 
      entityType, 
      entityId, 
      documentType: data.documentType,
      filesQueued,
      hasUploader: !!uploaderRef.current 
    });

    // Validate entity selection
    if (!entityType || !entityId) {
      toast({ title: "Entity information is missing", variant: "destructive" });
      return;
    }

    // Validate files queued - check the actual files from the uploader
    if (!uploaderRef.current) {
      console.error("❌ Uploader ref is null");
      toast({ title: "Uploader not initialized", variant: "destructive" });
      return;
    }

    const queuedFiles = uploaderRef.current.getFiles();
    console.log("🔵 Files from uploader:", queuedFiles.length, queuedFiles.map(f => f.name));

    if (queuedFiles.length === 0) {
      console.error("❌ No files in uploader");
      toast({ title: "Please select a file first", variant: "destructive" });
      return;
    }

    setIsUploading(true);

    try {
      console.log("🔵 Starting upload for", queuedFiles.length, "file(s)");
      
      // Trigger upload
      const result = await uploaderRef.current.upload();

      // Check if any files succeeded
      if (!result.successful || result.successful.length === 0) {
        toast({ 
          title: "Upload failed", 
          description: "No files were uploaded successfully",
          variant: "destructive" 
        });
        setIsUploading(false);
        return;
      }

      // Save each successful file to database
      for (const file of result.successful) {
        await saveDocumentMutation.mutateAsync({
          entityType,
          entityId,
          documentType: data.documentType,
          bucketKey: file.bucketKey,
          mimeType: file.type,
          sizeBytes: file.size,
          originalName: file.name,
        });
      }

      toast({ title: `${result.successful.length} document(s) uploaded successfully` });
      handleClose();
    } catch (error) {
      console.error("Upload or save failed:", error);
      toast({ 
        title: "Upload failed", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canUpload) return;
    e.preventDefault();
    e.stopPropagation();
    
    // Only set to false if we're leaving the container itself (not a child)
    if (e.currentTarget === e.target) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (!canUpload) return;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length === 0) return;

    const currentCount = uploaderRef.current?.getFiles().length || 0;
    const { accepted, rejectedReasons, truncated } = validateDroppedFiles(droppedFiles, currentCount);

    // Show rejection messages
    if (rejectedReasons.length > 0) {
      toast({
        title: "Some files were rejected",
        description: rejectedReasons.join('; '),
        variant: "destructive"
      });
    }

    if (truncated) {
      toast({
        title: "File limit reached",
        description: `Maximum 5 files allowed. Extra files were ignored.`,
        variant: "destructive"
      });
    }

    // Inject accepted files
    if (accepted.length > 0) {
      injectFilesIntoObjectUploader(accepted);
    }
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

  const canUpload = entityType && entityId;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        
        <div className="mt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="documentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Document Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select document type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {documentTypes.map((type) => (
                          <SelectItem key={type} value={type.toLowerCase().replace(/\s+/g, '_')}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {isContextualMode && entityDisplayName ? (
                <FormItem>
                  <FormLabel>Related Entity</FormLabel>
                  <div className="flex items-center h-10 px-3 rounded-md border bg-muted text-sm">
                    {entityDisplayName}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Document will be linked to this {entityType?.replace(/_/g, ' ')}
                  </p>
                </FormItem>
              ) : !isContextualMode ? (
                <>
                  <FormItem>
                    <FormLabel>Entity Type</FormLabel>
                    <Select 
                      value={selectedEntityType} 
                      onValueChange={(value) => setSelectedEntityType(value as EntityType)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select entity type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ENTITY_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>

                  {selectedEntityType && (
                    <FormItem>
                      <FormLabel>
                        Select {ENTITY_TYPE_OPTIONS.find(o => o.value === selectedEntityType)?.label}
                      </FormLabel>
                      <Select 
                        value={selectedEntityId} 
                        onValueChange={setSelectedEntityId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={`Select ${selectedEntityType.replace(/_/g, ' ')}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {entityOptions.length === 0 ? (
                            <SelectItem value="_none" disabled>
                              No {selectedEntityType.replace(/_/g, ' ')}s found
                            </SelectItem>
                          ) : (
                            entityOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                </>
              ) : null}
              
              <div>
                <div 
                  ref={uploaderRootRef}
                  className={cn(
                    "transition-all duration-200",
                    isDragActive && "ring-2 ring-primary ring-offset-2"
                  )}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {canUpload ? (
                    <ObjectUploader
                      ref={uploaderRef}
                      maxNumberOfFiles={10}
                      maxFileSize={10485760}
                      onGetUploadParameters={(file) => getUploadParameters(entityType!, entityId!, file)}
                      onFilesChange={setFilesQueued}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 px-6 text-center border-2 border-dashed rounded-2xl">
                      <p className="text-sm text-muted-foreground">
                        {!isContextualMode 
                          ? "Please select an entity type and record above to enable upload"
                          : "Entity information is required to upload"
                        }
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="modal-footer-actions pt-6">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleClose}
                  disabled={isUploading}
                  size="lg"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isUploading || filesQueued === 0 || !canUpload}
                  size="lg"
                >
                  {isUploading && (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  )}
                  Upload Document
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
