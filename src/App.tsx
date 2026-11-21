import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppVersionNotifier } from "@/components/AppVersionNotifier";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { Loader2 } from "lucide-react";
import DashboardLayout from "@/layouts/DashboardLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CustomersPage from "@/pages/Customers";
import OwnerProfilePage from "@/pages/OwnerProfile";
import BoardingPage from "@/pages/Boarding";
import PetProfilePage from "@/pages/PetProfile";
import RoomsAdminPage from "@/pages/RoomsAdmin";
import BillingPage from "@/pages/Billing";
import PaymentsPage from "@/pages/PaymentsPage";
import InvoiceListPage from "@/pages/billing/InvoiceList";
import InvoiceDetailPage from "@/pages/billing/InvoiceDetail";
import CreateInvoicePage from "@/pages/billing/CreateInvoice";
import OwnerStatementPage from "@/pages/billing/OwnerStatement";
import DaycarePage from "@/pages/Daycare";
import ServiceCheckinsPage from "@/pages/ServiceCheckins";
import DailyChecklistPage from "@/pages/DailyChecklistPage";
import AgentPage from "@/pages/Agent";
import GroomingPage from "@/pages/Grooming";
import StaffPage from "@/pages/Staff";
import ProfilePage from "@/pages/Profile";
import SettingsPage from "@/pages/SettingsPage";
import VetsAdminPage from "@/pages/VetsAdmin";
import StaffAdminPage from "@/pages/StaffAdmin";
import DataIssuesAdminPage from "@/pages/DataIssuesAdmin";
import TransportPage from "@/pages/Transport";
import VisitRequestsPage from "@/pages/VisitRequests";
import KennelCardPrintPage from "@/pages/print/KennelCardPrintPage";
import KennelCardsPrintPage from "@/pages/print/KennelCardsPrintPage";
import KennelMapPrintPage from "@/pages/print/KennelMapPrintPage";
import GroomingCardPrintPage from "@/pages/print/GroomingCardPrintPage";
import GroomingCardsPrintPage from "@/pages/print/GroomingCardsPrintPage";
import InvoicePrintPage from "@/pages/print/InvoicePrintPage";
import TopupReceiptPrintPage from "@/pages/print/TopupReceiptPrintPage";
import SetupPasswordPage from "@/pages/SetupPasswordPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      <p className="text-sm">Loading session…</p>
    </div>
  );
}

function hasInvitePayload(search: string, hash: string): boolean {
  const searchParams = new URLSearchParams(search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return (
    !!searchParams.get("code") ||
    !!searchParams.get("token_hash") ||
    !!searchParams.get("access_token") ||
    !!hashParams.get("code") ||
    !!hashParams.get("token_hash") ||
    !!hashParams.get("access_token")
  );
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { session, loading } = useAuth();
  if (loading) return <AuthLoadingScreen />;
  if (!session) {
    if (hasInvitePayload(location.search, location.hash)) {
      return (
        <Navigate
          to={`/auth/setup-password${location.search}${location.hash}`}
          replace
        />
      );
    }
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const PublicRoute = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const { session, loading } = useAuth();
  if (loading) return <AuthLoadingScreen />;
  if (hasInvitePayload(location.search, location.hash)) return <>{children}</>;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BranchProvider>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppVersionNotifier />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
            <Route path="/auth/setup-password" element={<SetupPasswordPage />} />
            <Route path="/print/kennel-card/:bookingId" element={<ProtectedRoute><KennelCardPrintPage /></ProtectedRoute>} />
            <Route path="/print/kennel-cards" element={<ProtectedRoute><KennelCardsPrintPage /></ProtectedRoute>} />
            <Route path="/print/kennel-map" element={<ProtectedRoute><KennelMapPrintPage /></ProtectedRoute>} />
            <Route path="/print/grooming-card/:bookingId" element={<ProtectedRoute><GroomingCardPrintPage /></ProtectedRoute>} />
            <Route path="/print/grooming-cards" element={<ProtectedRoute><GroomingCardsPrintPage /></ProtectedRoute>} />
            <Route path="/print/invoice/:invoiceId" element={<ProtectedRoute><InvoicePrintPage /></ProtectedRoute>} />
            <Route path="/print/topup-receipt/:receiptId" element={<ProtectedRoute><TopupReceiptPrintPage /></ProtectedRoute>} />
            {/* path="/" layout + relative child paths so <Outlet /> resolves (pathless parent + path="/" child breaks RR6 matching) */}
            <Route path="/" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="visit-requests" element={<VisitRequestsPage />} />
              <Route path="customers/:id" element={<OwnerProfilePage />} />
              <Route path="customers/:ownerId/pets/:petId" element={<PetProfilePage />} />
              <Route path="boarding" element={<BoardingPage />} />
              <Route path="daycare" element={<DaycarePage />} />
              <Route path="transport" element={<TransportPage />} />
              <Route path="dashboard/checkins" element={<ServiceCheckinsPage />} />
              <Route path="daily-checklist" element={<DailyChecklistPage />} />
              <Route path="agent" element={<AgentPage />} />
              <Route path="grooming" element={<GroomingPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="billing/invoices" element={<InvoiceListPage />} />
              <Route path="billing/invoices/new" element={<CreateInvoicePage />} />
              <Route path="billing/invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="billing/statements/:ownerId" element={<OwnerStatementPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/vets" element={<VetsAdminPage />} />
              <Route path="settings/staff" element={<StaffAdminPage />} />
              <Route path="settings/rooms" element={<RoomsAdminPage />} />
              <Route path="settings/data-issues" element={<DataIssuesAdminPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
    </BranchProvider>
  </QueryClientProvider>
);

export default App;
