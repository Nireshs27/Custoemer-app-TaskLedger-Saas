import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
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
import { Plus, X, Loader2 } from "lucide-react";
import { useCategories, useDeactivateCategory } from "@/hooks/use-categories";
import { CreateCategoryDialog } from "./create-category-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type CategoryModule = 'vehicle' | 'asset' | 'task_action' | 'tax_legal' | 'reminder_tasks';

interface CategorySelectProps {
  module: CategoryModule;
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function CategorySelect({
  module,
  value,
  onChange,
  disabled = false,
  placeholder = "Select category",
  className,
}: CategorySelectProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<{ id: string; name: string } | null>(null);
  const { data: categories = [], isLoading } = useCategories(module);
  const deactivateMutation = useDeactivateCategory();
  const { toast } = useToast();

  const handleDelete = (categoryId: string, categoryName: string, isSystem: boolean) => {
    if (isSystem) {
      toast({
        title: "Cannot Delete",
        description: "System categories cannot be deleted",
        variant: "destructive",
      });
      return;
    }
    setCategoryToDelete({ id: categoryId, name: categoryName });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!categoryToDelete) return;

    try {
      await deactivateMutation.mutateAsync(categoryToDelete.id);
      toast({
        title: "Success",
        description: "Category has been deactivated",
      });
      
      // If the deleted category was selected, clear the selection
      if (normalizedValue === categoryToDelete.id) {
        onChange("");
      }
      
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to deactivate category",
        variant: "destructive",
      });
    }
  };

  // Normalize value to always use id format
  const normalizedValue = useMemo(() => {
    if (!value) return "";
    const category = categories.find(c => c.id === value || c.slug === value || c.name === value);
    return category ? category.id : value;
  }, [value, categories]);

  // Find the label for the current value
  const getDisplayValue = () => {
    if (!normalizedValue) return placeholder;
    const category = categories.find(c => c.id === normalizedValue);
    return category ? category.name : normalizedValue;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Select disabled>
          <SelectTrigger className={cn("flex-1", className)}>
            <SelectValue placeholder="Loading..." />
          </SelectTrigger>
        </Select>
        <Button type="button" variant="outline" size="icon" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Select value={normalizedValue} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className={cn("flex-1", className)}>
            <SelectValue placeholder={placeholder}>
              {getDisplayValue()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categories.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">
                No categories available
              </div>
            ) : (
              categories.map((category) => (
                <SelectItem key={category.id} value={category.id} className="pr-10 relative group">
                  <div className="flex items-center justify-between w-full">
                    <span>{category.name}</span>
                    {!category.isSystem && (
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(category.id, category.name, category.isSystem);
                        }}
                        className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete category"
                      >
                        <X className="h-3.5 w-3.5 text-destructive hover:text-destructive/80" />
                      </button>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setCreateDialogOpen(true)}
          disabled={disabled}
          title="Add new category"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <CreateCategoryDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        module={module}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Category?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate the category "{categoryToDelete?.name}"? 
              This will hide it from the dropdown, but existing records using this category will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deactivateMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deactivateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

