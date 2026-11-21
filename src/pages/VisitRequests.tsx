import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { CalendarCheck, Inbox, MessageCircle, Phone, X } from "lucide-react";
import { toast } from "sonner";
import TopBar from "@/components/dashboard/TopBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import {
  useUpdateVisitRequest,
  useVisitRequests,
  VISIT_INTEREST_LABEL,
  VISIT_STATUS_LABEL,
  type VisitRequest,
  type VisitRequestStatus,
} from "@/hooks/useVisitRequests";
import { visitWhatsAppUrl } from "@/lib/visitRequestWhatsApp";

type Filter = "open" | VisitRequestStatus | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "To do" },
  { id: "contacted", label: "Contacted" },
  { id: "booked", label: "Trial booked" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

const STATUS_STYLE: Record<VisitRequestStatus, string> = {
  new: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  contacted: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  booked: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  closed: "bg-muted text-muted-foreground",
};

function matches(filter: Filter, r: VisitRequest) {
  if (filter === "all") return true;
  if (filter === "open") return r.status === "new";
  return r.status === filter;
}

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${formatDistanceToNow(d, { addSuffix: true })} (${format(d, "d MMM, HH:mm")})`;
}

function RequestRow({ r }: { r: VisitRequest }) {
  const { staff } = useCurrentStaffName();
  const update = useUpdateVisitRequest();
  const [note, setNote] = useState(r.staff_note ?? "");
  const waHref = visitWhatsAppUrl(r);

  const setStatus = (status: VisitRequestStatus) =>
    update.mutate(
      { id: r.id, status, handled_by: staff?.id ?? null, staff_note: note.trim() || null },
      {
        onSuccess: () => toast.success(`${r.contact_name}: ${VISIT_STATUS_LABEL[status]}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the request"),
      },
    );

  const contact = () => {
    if (r.status === "new") setStatus("contacted");
  };

  return (
    <li className="rounded-xl border bg-card p-4 space-y-3" data-testid="visit-requests-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{r.contact_name}</span>
            {r.pet_name ? <span className="text-muted-foreground">with {r.pet_name}</span> : null}
            <Badge variant="secondary" className={STATUS_STYLE[r.status]}>{VISIT_STATUS_LABEL[r.status]}</Badge>
            {r.interest ? <Badge variant="outline">{VISIT_INTEREST_LABEL[r.interest]}</Badge> : null}
          </div>
          <div className="text-sm text-muted-foreground">{r.phone} · requested {when(r.created_at)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {waHref ? (
            <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={contact}>
              <a href={waHref} target="_blank" rel="noopener noreferrer" data-testid="visit-requests-whatsapp-btn"><MessageCircle className="h-4 w-4 mr-1.5" />WhatsApp</a>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline" onClick={contact}>
            <a href={`tel:${r.phone}`}><Phone className="h-4 w-4 mr-1.5" />Call</a>
          </Button>
        </div>
      </div>
      {r.client_note ? (
        <blockquote className="whitespace-pre-line rounded-lg border-l-4 border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2 text-sm">
          <span className="block text-xs font-medium text-muted-foreground mb-0.5">From the client</span>
          {r.client_note}
        </blockquote>
      ) : null}
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if ((r.staff_note ?? "") !== note.trim()) update.mutate({ id: r.id, staff_note: note.trim() || null });
        }}
        placeholder="Note for the team (e.g. trial booked Saturday 9am)"
        rows={2}
        maxLength={1000}
        className="text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {r.status !== "contacted" && r.status !== "booked" ? (
          <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => setStatus("contacted")}>Mark contacted</Button>
        ) : null}
        {r.status !== "booked" ? (
          <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => setStatus("booked")}>
            <CalendarCheck className="h-4 w-4 mr-1.5" />Trial booked
          </Button>
        ) : null}
        {r.status !== "closed" ? (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => setStatus("closed")}>
            <X className="h-4 w-4 mr-1.5" />Close
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => setStatus("new")}>Reopen</Button>
        )}
      </div>
    </li>
  );
}

export default function VisitRequestsPage() {
  const { data = [], isLoading, error } = useVisitRequests();
  const [filter, setFilter] = useState<Filter>("open");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, new: 0, contacted: 0, booked: 0, closed: 0, all: data.length };
    for (const r of data) {
      c[r.status] += 1;
      if (r.status === "new") c.open += 1;
    }
    return c;
  }, [data]);

  const rows = data.filter((r) => matches(filter, r));

  return (
    <>
      <TopBar title="Visit Requests" />
      <main className="flex-1 overflow-auto p-4 sm:p-8 space-y-6">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Requests from the &ldquo;Request a visit&rdquo; form on woofdubai.ae. Reach out on WhatsApp or by phone to arrange the
          free assessment and daycare trial, then mark where it stands.
        </p>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="flex-wrap h-auto">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.id} value={f.id} data-testid={`visit-requests-tab-${f.id}`}>
                {f.label}
                <span className="ml-1.5 text-xs text-muted-foreground">{counts[f.id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {error ? (
          <p className="text-sm text-destructive">Could not load visit requests: {error instanceof Error ? error.message : String(error)}</p>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <span>{filter === "open" ? "No new requests. All caught up." : "Nothing here."}</span>
          </div>
        ) : (
          <ul className="space-y-3 max-w-4xl">
            {rows.map((r) => <RequestRow key={r.id} r={r} />)}
          </ul>
        )}
      </main>
    </>
  );
}
