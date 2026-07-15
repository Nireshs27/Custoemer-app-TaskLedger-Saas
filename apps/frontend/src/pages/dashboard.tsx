import { useState } from "react";
import Header from "@/components/layout/header";
import StatsCards from "@/components/dashboard/stats-cards";
import UpcomingDueDates from "@/components/dashboard/upcoming-due-dates";
import QuickActions from "@/components/dashboard/quick-actions";
import PropertiesOverview from "@/components/dashboard/properties-overview";
import AssetsVehicles from "@/components/dashboard/assets-vehicles";
import CalendarView from "@/components/calendar/calendar-view";
import TaskView from "@/components/task/task-view";
import AddNewModal from "@/components/modals/add-new-modal";
import UserManagementModal from "@/components/modals/user-management-modal";
import DocumentUploadModal from "@/components/modals/document-upload-modal";

export default function Dashboard() {
  const [currentView, setCurrentView] = useState<'dashboard' | 'calendar' | 'tasks'>('dashboard');
  const [isAddNewModalOpen, setIsAddNewModalOpen] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);

  return (
    <>
      <Header 
        currentView={currentView}
        onViewChange={setCurrentView}
      />

      {currentView === 'dashboard' ? (
        <div className="p-4 sm:p-6 lg:p-8" data-testid="dashboard-content">
            {/* Alert Banner */}
            <div className="bg-white shadow-occurrence rounded-2xl p-4 mb-6">
              <div className="flex items-center space-x-3">
                <i className="fas fa-exclamation-triangle text-chart-2"></i>
                <div>
                  <h3 className="font-semibold text-foreground">Upcoming Due Dates</h3>
                  <p className="text-sm text-muted-foreground">You have items due in the next 7 days</p>
                </div>
              </div>
            </div>

            <StatsCards />

            {/* Bento Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <UpcomingDueDates />
              </div>
              <QuickActions onAddNew={() => setIsAddNewModalOpen(true)} />
            </div>

            {/* Secondary Bento Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <PropertiesOverview />
              <AssetsVehicles />
            </div>
          </div>
        ) : currentView === 'calendar' ? (
          <div className="p-4 sm:p-6 lg:p-8" data-testid="calendar-content">
            <CalendarView />
          </div>
        ) : (
          <div className="p-4 sm:p-6 lg:p-8" data-testid="tasks-content">
            <TaskView />
          </div>
      )}
      
      <AddNewModal 
        isOpen={isAddNewModalOpen}
        onClose={() => setIsAddNewModalOpen(false)}
      />
      
      <UserManagementModal 
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
      />
      
      <DocumentUploadModal 
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
      />
    </>
  );
}
