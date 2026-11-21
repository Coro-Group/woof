import {
  Inbox,
  LayoutDashboard,
  Users,
  Hotel,
  Sun,
  Truck,
  Scissors,
  Wallet,
  Receipt,
  ClipboardList,
  ListChecks,
  LogOut,
  PawPrint,
  Settings,
  DoorOpen,
  Sparkles,
  Stethoscope,
  AlertTriangle,
  UserCog,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ListChecks, label: "Daily Checklist", path: "/daily-checklist" },
  { icon: Users, label: "Customers & Pets", path: "/customers" },
  { icon: Inbox, label: "Visit Requests", path: "/visit-requests" },
  { icon: Hotel, label: "Boarding", path: "/boarding" },
  { icon: Sun, label: "Daycare", path: "/daycare" },
  { icon: Truck, label: "Transport", path: "/transport" },
  { icon: Scissors, label: "Grooming", path: "/grooming" },
  { icon: Wallet, label: "Billing & Wallets", path: "/billing" },
  { icon: Receipt, label: "Payments", path: "/payments" },
  { icon: ClipboardList, label: "User Management", path: "/staff" },
  { icon: Sparkles, label: "AI Assistant", path: "/agent" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const settingsItems = [
  { icon: Stethoscope, label: "Vets", path: "/settings/vets" },
  { icon: UserCog, label: "Staff", path: "/settings/staff" },
  { icon: DoorOpen, label: "Rooms", path: "/settings/rooms" },
  { icon: AlertTriangle, label: "Data issues", path: "/settings/data-issues" },
];

const AppSidebar = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <aside className="flex h-screen w-60 flex-col bg-sidebar text-sidebar-foreground shrink-0">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-sidebar-border">
        <PawPrint className="h-6 w-6 text-sidebar-primary" />
        <span className="text-base font-bold tracking-tight text-sidebar-accent-foreground">
          woof
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto flex flex-col gap-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/"}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="bg-sidebar-accent text-sidebar-primary"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}

        {/* Settings section */}
        <div className="mt-4 mb-1 px-3 flex items-center gap-2">
          <Settings className="h-3 w-3 text-sidebar-foreground/50" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
            Settings
          </span>
        </div>
        {settingsItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            activeClassName="bg-sidebar-accent text-sidebar-primary"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4 space-y-3">
        <button
          type="button"
          onClick={() => navigate("/profile")}
          className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground uppercase">
            {user?.email?.charAt(0) ?? "?"}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs text-sidebar-accent-foreground">{user?.email ?? "Staff"}</div>
            <div className="text-[10px] text-sidebar-foreground/60">View profile</div>
          </div>
        </button>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
