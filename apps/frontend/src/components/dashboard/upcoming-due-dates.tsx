import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, Car, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, differenceInDays } from "date-fns";
import { TaskActionMenu } from "@/components/task-action-menu";

interface DueItem {
  id: string;
  title: string;
  category: string;
  dueDate: string;
  status: string;
  entityType: 'tax' | 'vehicle' | 'asset' | 'action';
  entityId?: string;
  occurrenceKey?: string;
}

interface UpcomingData {
  upcoming: DueItem[];
  overdue: DueItem[];
}

export default function UpcomingDueDates() {
  const { data, isLoading } = useQuery<UpcomingData>({
    queryKey: ["/api/dashboard/upcoming-due-dates"],
  });

  const parseEntityIdFromOccurrenceKey = (key?: string): string | null => {
    if (!key) return null;
    const before = key.split("::")[0] || "";
    const uuid = before.includes(":") ? before.split(":").pop() : before;
    return uuid && uuid.length > 0 ? uuid : null;
  };

  if (isLoading) {
    return (
      <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-16" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between p-4 rounded-lg bg-muted/50 shadow-lg">
                <div className="flex items-center space-x-4">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <div className="text-right space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort overdue items DESCENDING (newest overdue date first / Jan-06 before Jan-05)
  const overdueItems = [...(data?.overdue || [])].sort((a, b) => 
    new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()
  );

  const getIcon = (entityType: string, category: string) => {
    switch (entityType) {
      case 'vehicle':
        return Car;
      case 'asset':
        return FileText;
      default:
        return Receipt;
    }
  };

  const getIconColor = (status: string, daysRemaining: number) => {
    if (status === 'completed') return 'text-green-600';
    if (daysRemaining < 0) return 'text-destructive';
    return 'text-chart-2';
  };

  const getBgColor = (status: string, daysRemaining: number) => {
    if (status === 'completed') return 'bg-green-50';
    if (daysRemaining < 0) return 'bg-destructive/10';
    return 'bg-chart-2/10';
  };

  const getStatusText = (dueDate: string, status: string) => {
    const today = new Date();
    const due = new Date(dueDate);
    const daysRemaining = differenceInDays(due, today);

    if (status === 'completed') return 'Completed';
    if (daysRemaining < 0) {
      const daysOverdue = Math.abs(daysRemaining);
      return `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`;
    }
    return `${daysRemaining} day${daysRemaining > 1 ? 's' : ''} remaining`;
  };

  return (
    <Card className="shadow-md hover:-translate-y-1 transition-all duration-300">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Overdue Dates</h2>
        </div>
      </CardHeader>
      <CardContent>
        {overdueItems.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No overdue dates</p>
          </div>
        ) : (
          <div className="space-y-3">
            {overdueItems.slice(0, 5).map((item) => {
              const today = new Date();
              const due = new Date(item.dueDate);
              const daysRemaining = differenceInDays(due, today);
              const Icon = getIcon(item.entityType, item.category);
              const iconColor = getIconColor(item.status, daysRemaining);
              const bgColor = getBgColor(item.status, daysRemaining);

              const occurrenceKey = item.occurrenceKey || 
                (typeof item.id === "string" && item.id.includes("::") ? item.id : undefined);

              const entityIdForMenu = item.entityId || 
                parseEntityIdFromOccurrenceKey(occurrenceKey) || 
                item.id;

              return (
                <div 
                  key={item.id} 
                  className="flex items-start gap-3 p-3 sm:p-4 border rounded-xl shadow-lg transition-all duration-200"
                  data-testid={`due-item-${item.id}`}
                >
                  <div className={`w-10 h-10 ${bgColor} rounded-lg flex items-center justify-center shrink-0`}>
                    <Icon className={`w-5 h-5 ${iconColor}`} />
                  </div>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <h4 className="font-medium text-foreground truncate" data-testid={`item-title-${item.id}`}>
                      {item.title}
                    </h4>
                    <p className="text-sm text-muted-foreground capitalize truncate">
                      {item.category} • {item.entityType}
                    </p>
                    <p className={`text-sm font-medium ${iconColor}`}>
                      Due: {format(due, 'MMM dd, yyyy')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getStatusText(item.dueDate, item.status)}
                    </p>
                  </div>

                  <div className="shrink-0 self-center">
                    <TaskActionMenu
                      entityType={
                        item.entityType === 'tax' ? 'tax_legal_item' : 
                        item.entityType === 'vehicle' ? 'vehicle_item' : 
                        item.entityType === 'asset' ? 'asset_item' :
                        'task_action_item'
                      }
                      entityId={entityIdForMenu}
                      entityTitle={item.title}
                      status={item.status}
                      isRecurring={Boolean(occurrenceKey)}
                      occurrenceKey={occurrenceKey}
                      hideDelete={true}
                      variant="icon"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
