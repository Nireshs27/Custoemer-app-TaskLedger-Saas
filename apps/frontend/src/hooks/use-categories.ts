import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { TaxTrackerCategory } from "@shared/schema";

type CategoryModule = 'vehicle' | 'asset' | 'task_action' | 'tax_legal' | 'reminder_tasks';

export function useCategories(module: CategoryModule) {
  return useQuery<TaxTrackerCategory[]>({
    queryKey: [`/api/categories`, { module }],
    queryFn: async () => {
      const response = await fetch(`/api/categories?module=${module}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch categories");
      }
      return response.json();
    },
  });
}

export function useCreateCategory() {
  return useMutation({
    mutationFn: async (data: { module: CategoryModule; name: string }) => {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create category");
      }
      return response.json();
    },
    onSuccess: (_data, variables) => {
      // Invalidate the categories query for the specific module
      queryClient.invalidateQueries({ queryKey: [`/api/categories`, { module: variables.module }] });
    },
  });
}

export function useDeactivateCategory() {
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/categories/${id}/deactivate`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to deactivate category");
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate all category queries to refresh the lists
      queryClient.invalidateQueries({ queryKey: [`/api/categories`] });
    },
  });
}

