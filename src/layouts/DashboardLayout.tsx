import { Outlet } from "react-router-dom";
import AppSidebar from "@/components/dashboard/AppSidebar";
import VisitRequestAlertHost from "@/components/dashboard/VisitRequestAlertHost";

const DashboardLayout = () => {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <VisitRequestAlertHost />
        <Outlet />
      </div>
    </div>
  );
};

export default DashboardLayout;
