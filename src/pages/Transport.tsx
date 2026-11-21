import { useSearchParams } from "react-router-dom";
import TopBar from "@/components/dashboard/TopBar";
import { ActivityTab } from "@/components/transport/ActivityTab";
import { DeskTab } from "@/components/transport/DeskTab";
import { RegularsTab } from "@/components/transport/RegularsTab";
import { RequestsTab } from "@/components/transport/RequestsTab";
import { ScheduleTab } from "@/components/transport/ScheduleTab";
import { TransportHubCard } from "@/components/transport/TransportHubCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["desk", "requests", "regulars", "schedule", "activity"] as const;
type Tab = (typeof TABS)[number];

/**
 * Desk is the day read back as stops, the way Petzania and AE show it: what the vans
 * are being asked to do and what is wrong with it. There is no Master here — that
 * board lives only in admin-essentials, where dispatch plans every brand's vans.
 * Requests, Regulars and Schedule are this kennel's own work, and Activity is the
 * trail of what was offered, accepted and changed.
 *
 * Staff still land on Requests: until the hub is connected, Desk shows only Woof's own
 * stops, and opening on half a board would read as the whole one.
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
            <TabsTrigger value="desk" data-testid="transport-tab-desk">Desk</TabsTrigger>
            <TabsTrigger value="requests" data-testid="transport-tab-requests">Requests</TabsTrigger>
            <TabsTrigger value="regulars" data-testid="transport-tab-regulars">Regulars</TabsTrigger>
            <TabsTrigger value="schedule" data-testid="transport-tab-schedule">Schedule</TabsTrigger>
            <TabsTrigger value="activity" data-testid="transport-tab-activity">Activity</TabsTrigger>
          </TabsList>
          <TabsContent value="desk" className="mt-0"><DeskTab /></TabsContent>
          <TabsContent value="requests" className="mt-0"><RequestsTab /></TabsContent>
          <TabsContent value="regulars" className="mt-0"><RegularsTab /></TabsContent>
          <TabsContent value="schedule" className="mt-0"><ScheduleTab /></TabsContent>
          <TabsContent value="activity" className="mt-0"><ActivityTab /></TabsContent>
        </Tabs>
      </main>
    </>
  );
};

export default TransportPage;
