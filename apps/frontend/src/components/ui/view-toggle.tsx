import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  LayoutGrid, 
  List, 
  Search, 
  Filter, 
  SortAsc,
  Plus,
  ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ViewToggleProps {
  title: string;
  subtitle?: string;
  currentView: 'card' | 'list';
  onViewChange: (view: 'card' | 'list') => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filterValue: string;
  onFilterChange: (value: string) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  onAddNew?: () => void;
  filterOptions: { value: string; label: string }[];
  sortOptions: { value: string; label: string }[];
  addButtonLabel?: string;
  itemCount?: number;
  showBackButton?: boolean;
  onBack?: () => void;
  backButtonLabel?: string;
}

export function ViewToggle({
  title,
  subtitle,
  currentView,
  onViewChange,
  searchValue,
  onSearchChange,
  filterValue,
  onFilterChange,
  sortValue,
  onSortChange,
  onAddNew,
  filterOptions,
  sortOptions,
  addButtonLabel = "Add New",
  itemCount,
  showBackButton = false,
  onBack,
  backButtonLabel = "Back to Dashboard"
}: ViewToggleProps) {
  return (
    <Card className="mb-6 shadow-sm">
      <CardHeader className="pb-4">
        {showBackButton && onBack && (
          <div className="mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground"
              data-testid="button-back"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              {backButtonLabel}
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl text-foreground">{title}</CardTitle>
            {subtitle && (
              <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
            )}
            {itemCount !== undefined && (
              <p className="text-xs text-muted-foreground mt-1">
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </p>
            )}
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 w-64"
                data-testid="input-search"
              />
            </div>

            {/* Filter */}
            <Select value={filterValue} onValueChange={onFilterChange}>
              <SelectTrigger className="w-40" data-testid="select-filter">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                {filterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort */}
            <Select value={sortValue} onValueChange={onSortChange}>
              <SelectTrigger className="w-36" data-testid="select-sort">
                <SortAsc className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {sortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* View Toggle */}
            <div className="flex bg-muted rounded-lg p-1">
              <Button
                variant={currentView === 'card' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => onViewChange('card')}
                className={cn(
                  "px-3 py-2",
                  currentView === 'card' 
                    ? "bg-background shadow-sm" 
                    : "hover:bg-background/50"
                )}
                data-testid="view-card"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={currentView === 'list' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => onViewChange('list')}
                className={cn(
                  "px-3 py-2",
                  currentView === 'list' 
                    ? "bg-background shadow-sm" 
                    : "hover:bg-background/50"
                )}
                data-testid="view-list"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            {/* Add Button */}
            {onAddNew && (
              <Button onClick={onAddNew} data-testid="button-add-new">
                <Plus className="w-4 h-4 mr-2" />
                {addButtonLabel}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}