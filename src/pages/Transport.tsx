import { useSearchParams } from "react-router-dom";
import TopBar from "@/components/dashboard/TopBar";
import { RegularsTab } from "@/components/transport/RegularsTab";
import { RequestsTab } from "@/components/transport/RequestsTab";
import { ScheduleTab } from "@/components/transport/ScheduleTab";
import { TransportHubCard } from "@/components/transport/TransportHubCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["requests", "schedule", "regulars"] as const;
type Tab = (typeof TABS)[number];

/**
 * Woof keeps the ask: requests, the day's schedule, and regulars.
 * Desk and Master live on admin-essentials, where dispatch plans the vans.
 */
const TransportPage = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "requests";

  return (
    <>
      <TopBar title="Transport" />
      <main className="flex-1 overflow-auto p-8 print:p-0">
        <div className="mb-6 print:hidden">
          <TransportHubCard />
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => setParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("tab", v);
            return next;
          })}
          className="space-y-6"
        >
          <TabsList className="print:hidden">
            <TabsTrigger value="requests" data-testid="transport-tab-requests">Requests</TabsTrigger>
            <TabsTrigger value="schedule" data-testid="transport-tab-schedule">Schedule</TabsTrigger>
            <TabsTrigger value="regulars" data-testid="transport-tab-regulars">Regulars</TabsTrigger>
          </TabsList>
          <TabsContent value="requests" className="mt-0"><RequestsTab /></TabsContent>
          <TabsContent value="schedule" className="mt-0"><ScheduleTab /></TabsContent>
          <TabsContent value="regulars" className="mt-0"><RegularsTab /></TabsContent>
        </Tabs>
      </main>
    </>
  );
};

export default TransportPage;
