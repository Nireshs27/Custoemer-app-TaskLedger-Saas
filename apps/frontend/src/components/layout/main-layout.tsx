import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Gauge, Receipt, Building, Car, ServerCog, FileText, Users, Settings, User, LogOut, CheckCircle, ChevronDown, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import DocumentUploadModal from "@/components/modals/document-upload-modal";
import UserManagementModal from "@/components/modals/user-management-modal";
import { MissedReminderBadge } from "@/components/reminders/missed-reminder-badge";
import {
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface MainLayoutProps {
  children: React.ReactNode;
}

type MenuItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path?: string;
  onClick?: () => void;
  adminOnly?: boolean;
};

export default function MainLayout({ children }: MainLayoutProps) {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const menuItems: MenuItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: Gauge, path: '/' },
    { id: 'tax-tracker', label: 'Tax & Legal Compliances', icon: Receipt, path: '/tax-tracker' },
    { id: 'vehicles', label: 'Vehicles', icon: Car, path: '/vehicles' },
    { id: 'assets', label: 'Assets', icon: ServerCog, path: '/assets' },
    { id: 'task-actions', label: 'Task Actions', icon: CheckCircle, path: '/task-actions' },
    { id: 'properties', label: 'Properties', icon: Building, path: '/properties' },
    { id: 'documents', label: 'Documents', icon: FileText, onClick: () => setShowDocuments(true) },
    { id: 'users', label: 'Management', icon: Users, onClick: () => setShowUserManagement(true), adminOnly: true },
    { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
  ];

  const visibleMenuItems = menuItems.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  );

  const handleItemClick = (item: MenuItem) => {
    if (item.onClick) {
      item.onClick();
    }
    setMobileMenuOpen(false);
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const renderNavItem = (item: MenuItem, variant: 'desktop' | 'mobile') => {
    const Icon = item.icon;
    const isActive = item.path && location === item.path;

    if (item.onClick) {
      return (
        <button
          key={item.id}
          onClick={() => handleItemClick(item)}
          className={cn(
            variant === 'desktop'
              ? "px-3 h-12 flex items-center gap-2 transition-all duration-300 ease-in-out relative hover:bg-white/10 rounded-lg group"
              : "w-full px-4 h-12 flex items-center gap-3 transition-all duration-200 hover:bg-muted rounded-lg text-left"
          )}
          data-testid={`nav-${item.id}`}
        >
          <Icon className={cn(
            "w-5 h-5 transition-transform duration-300 ease-in-out",
            variant === 'desktop' ? "text-white group-hover:scale-110" : "text-foreground"
          )} />
          <span className={cn(
            "text-sm font-medium",
            variant === 'desktop' ? "text-xs text-white whitespace-nowrap" : "text-foreground"
          )}>{item.label}</span>
        </button>
      );
    }

    if (item.path && item.path !== '#') {
      return (
        <Link href={item.path} key={item.id}>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className={cn(
              variant === 'desktop'
                ? cn(
                    "px-3 h-12 flex items-center gap-2 transition-all duration-300 ease-in-out relative rounded-lg group",
                    isActive ? "bg-white/5" : "hover:bg-white/10"
                  )
                : cn(
                    "w-full px-4 h-12 flex items-center gap-3 transition-all duration-200 rounded-lg text-left",
                    isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  )
            )}
            data-testid={`nav-${item.id}`}
          >
            <Icon className={cn(
              "w-5 h-5 transition-all duration-300 ease-in-out",
              variant === 'desktop' ? "text-white group-hover:scale-110" : ""
            )} />
            <span className={cn(
              "font-medium",
              variant === 'desktop' ? "text-xs text-white whitespace-nowrap" : "text-sm"
            )}>
              {item.label}
            </span>
            {variant === 'desktop' && isActive && (
              <div
                className="absolute bottom-0 left-0 right-0 h-1 rounded-full transition-all duration-300 ease-in-out mx-3"
                style={{ backgroundColor: '#058A77' }}
              />
            )}
          </button>
        </Link>
      );
    }

    return null;
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-col h-screen">
        <header className="flex h-16 sm:h-20 shrink-0 items-center justify-between gap-2 sm:gap-4 m-2 px-4 sm:px-8 rounded-full shadow-2xl sticky top-0 z-50" style={{backgroundColor: '#000'}}>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="lg:hidden flex items-center justify-center h-10 w-10 rounded-lg hover:bg-white/10 transition-colors"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              data-testid="nav-mobile-menu"
            >
              <Menu className="w-6 h-6 text-white" />
            </button>
            <img
              src="/logo.png"
              alt="Task Ledger"
              className="h-8 sm:h-10 w-auto object-contain"
            />
          </div>

          <nav className="hidden lg:flex items-center gap-3">
            {visibleMenuItems.map((item) => renderNavItem(item, 'desktop'))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <MissedReminderBadge />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 rounded-2xl transition-all duration-200 hover:bg-white/10 min-h-[44px]"
                  data-testid="user-menu-trigger"
                >
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{backgroundColor: '#058A77'}}>
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="text-left hidden md:block">
                    <p className="text-sm font-bold text-white" data-testid="text-user-name">
                      {user?.fullName}
                    </p>
                    <p className="text-xs capitalize" style={{color: '#FABF50'}} data-testid="text-user-role">
                      {user?.role} User
                    </p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-white hidden md:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '16px',
                  border: 'none',
                  boxShadow: '0 8px 24px rgba(1, 2, 28, 0.15)',
                  marginTop: '8px'
                }}
              >
                <DropdownMenuLabel className="font-semibold" style={{color: '#010100'}}>
                  My Account
                </DropdownMenuLabel>
                <DropdownMenuSeparator style={{backgroundColor: '#eeecea'}} />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <div className="flex items-center gap-2 cursor-pointer py-2">
                      <Settings className="w-4 h-4" />
                      <span>Settings</span>
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator style={{backgroundColor: '#eeecea'}} />
                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={logoutMutation.isPending}
                  className="cursor-pointer text-red-600 focus:text-red-600 py-2"
                  data-testid="button-logout"
                >
                  <div className="flex items-center gap-2">
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-[min(100vw-2rem,320px)] p-0 overflow-y-auto">
            <SheetHeader className="px-4 pt-6 pb-4 border-b">
              <SheetTitle className="text-left">Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-3">
              {visibleMenuItems.map((item) => renderNavItem(item, 'mobile'))}
            </nav>
          </SheetContent>
        </Sheet>

        <main className="flex-1 overflow-auto" style={{backgroundColor: '#D5CFD0'}}>
          <div className="page-container">
            {children}
          </div>
        </main>
      </div>

      <DocumentUploadModal
        isOpen={showDocuments}
        onClose={() => setShowDocuments(false)}
      />

      <UserManagementModal
        isOpen={showUserManagement}
        onClose={() => setShowUserManagement(false)}
      />
    </TooltipProvider>
  );
}
