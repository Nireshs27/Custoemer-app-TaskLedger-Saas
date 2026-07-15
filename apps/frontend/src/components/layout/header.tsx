import { Button } from "@/components/ui/button";
import { Calendar, LayoutDashboard, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  currentView: 'dashboard' | 'calendar' | 'tasks';
  onViewChange: (view: 'dashboard' | 'calendar' | 'tasks') => void;
}

export default function Header({ currentView, onViewChange }: HeaderProps) {
  return (
    <header className="bg-card border-b border-border px-4 sm:px-8 py-4 sm:py-6 rounded-xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            {currentView === 'dashboard' ? 'Dashboard Overview' : 
             currentView === 'calendar' ? 'Calendar View' : 'Task Management'}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {currentView === 'dashboard' 
              ? 'Manage your tasks, licenses, and renewals'
              : currentView === 'calendar' 
                ? 'View due dates and upcoming items in calendar format'
                : 'Organize and track all your tasks and reminders'
            }
          </p>
        </div>
        
        <div className="flex items-center shrink-0">
          <div className="flex items-center bg-muted rounded-lg p-1 gap-1 w-full sm:w-auto">
            <Button
              variant={currentView === 'dashboard' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewChange('dashboard')}
              className={cn(
                "text-sm font-medium flex-1 sm:flex-none min-h-[44px]",
                currentView === 'dashboard' 
                  ? "bg-card text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="button-dashboard-view"
            >
              <LayoutDashboard className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
            <Button
              variant={currentView === 'calendar' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewChange('calendar')}
              className={cn(
                "text-sm font-medium flex-1 sm:flex-none min-h-[44px]",
                currentView === 'calendar' 
                  ? "bg-card text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="button-calendar-view"
            >
              <Calendar className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Calendar</span>
            </Button>
            <Button
              variant={currentView === 'tasks' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewChange('tasks')}
              className={cn(
                "text-sm font-medium flex-1 sm:flex-none min-h-[44px]",
                currentView === 'tasks' 
                  ? "bg-card text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="button-tasks-view"
            >
              <CheckCircle className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Tasks</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
