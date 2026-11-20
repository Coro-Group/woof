import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Plus, StickyNote } from "lucide-react";
import { useTransportRequestRows, type TransportRequestWithDetails } from "@/hooks/useTransport";
import { dubaiToday, shiftIsoDate } from "@/lib/transportSchedule";
import {
  INBOX_SORTS,
  TONE_BADGE,
  TONE_TEXT,
  cardFirstDate,
  cardMatches,
  cardMissed,
  cardNeedsTime,
  cardSummary,
  dayDate,
  daysLate,
  dubaiDay,
  groupRequests,
  rowMissed,
  kindLabel,
  kindTone,
  sortInbox,
  statusLabel,
  statusTone,
  type InboxSort,
  type RequestCard,
} from "@/lib/transportRequests";
import { RequestDetailSheet } from "@/components/transport/RequestDetailSheet";
import { RequestForm } from "@/components/transport/RequestForm";
import { VetVisitForm } from "@/components/transport/VetVisitForm";
import {
  BranchBadge,
  BranchFilterToggle,
  RequestPetNames,
  TripNoteButton,
  matchesBranch,
  type BranchFilter,
} from "@/components/transport/transportShared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Card_ = RequestCard<TransportRequestWithDetails>;
type RequestsView = "inbox" | "approved" | "missed";

/**
 * Requests, laid out as in AE: Inbox (still to answer), Approved (agreed, by day) and
 * Missed (days that passed while an addition was still waiting). Clicking a card opens
 * its detail panel; New Request opens the form in a side sheet.
 */
export function RequestsTab() {
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState("");
  const [branch, setBranch] = useState<BranchFilter>("all");
  const [sort, setSort] = useState<InboxSort>("arrival");
  const viewParam = params.get("view");
  const view: RequestsView = viewParam === "approved" || viewParam === "missed" ? viewParam : "inbox";
  const openGroup = params.get("request");
  const newOpen = params.get("new") === "1";
  const [newMode, setNewMode] = useState<"record" | "vet">(() => (params.get("mode") === "vet" ? "vet" : "record"));

  const patch = (next: Record<string, string | null>) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("tab", "requests");
      for (const [k, v] of Object.entries(next)) {
        if (v == null || v === "") p.delete(k);
        else p.set(k, v);
      }
      return p;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">Requests in flight</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Status is where the ask sits (received → approved). Each card is an{" "}
            <span className="text-foreground">Addition</span>, a <span className="text-foreground">Cancellation</span>{" "}
            or a <span className="text-foreground">Pause</span>.
          </p>
        </div>
        <Button onClick={() => patch({ new: "1", request: null })} data-testid="transport-requests-new-btn">
          <Plus className="mr-1.5 h-4 w-4" />
          New Request
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && patch({ view: v === "inbox" ? null : v, request: null })}
        >
          <ToggleGroupItem value="inbox" data-testid="transport-requests-view-inbox">Inbox</ToggleGroupItem>
          <ToggleGroupItem value="approved" data-testid="transport-requests-view-approved">Approved</ToggleGroupItem>
          <ToggleGroupItem value="missed" data-testid="transport-requests-view-missed">Missed</ToggleGroupItem>
        </ToggleGroup>
        <Input
          className="w-56"
          placeholder="Filter by pet or owner…"
          data-testid="transport-requests-search"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {view === "inbox" && (
          <Select value={sort} onValueChange={(v) => setSort(v as InboxSort)}>
            <SelectTrigger className="w-52" aria-label="Order the inbox">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INBOX_SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Both branches share this inbox; either team can narrow it to its own asks. */}
        <BranchFilterToggle value={branch} onChange={setBranch} />
      </div>

      {view === "inbox" && <InboxView name={name} branch={branch} sort={sort} onOpen={(g) => patch({ request: g })} />}
      {view === "approved" && <ApprovedView name={name} branch={branch} onOpen={(g) => patch({ request: g })} />}
      {view === "missed" && <MissedView name={name} branch={branch} onOpen={(g) => patch({ request: g })} />}

      <RequestDetailSheet groupId={openGroup} onClose={() => patch({ request: null })} />

      <Sheet open={newOpen} onOpenChange={(open) => !open && patch({ new: null })}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Request</SheetTitle>
            <SheetDescription>
              {newMode === "vet"
                ? "A pet going from the kennel to the vet: an exact appointment the van must arrive before, and how it comes back."
                : "Record what the customer asked for. It lands in the Inbox as Received; approve it there once the transport team has a place for it."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <ToggleGroup type="single" variant="outline" size="sm" value={newMode} onValueChange={(v) => v && setNewMode(v as typeof newMode)}>
              <ToggleGroupItem value="record" data-testid="transport-new-mode-record">Record request</ToggleGroupItem>
              <ToggleGroupItem value="vet" data-testid="transport-new-mode-vet">Vet visit</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="mt-4">
            {newMode === "vet" ? (
              <VetVisitForm onSaved={() => patch({ new: null })} />
            ) : (
              <RequestForm onSaved={() => patch({ new: null })} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function useCards(scope: "open" | "approved" | "past", range: { from: string; to?: string } | null, name: string, branch: BranchFilter) {
  const { data, isLoading, error } = useTransportRequestRows(scope, range);
  const cards = useMemo(
    () => groupRequests(data ?? []).filter((c) => cardMatches(c, name) && matchesBranch(c.branchId, branch)),
    [data, name, branch],
  );
  return { cards, isLoading, error };
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground" data-testid="transport-requests-empty">
          {children}
        </p>
      </CardContent>
    </Card>
  );
}

function InboxView({
  name,
  branch,
  sort,
  onOpen,
}: {
  name: string;
  branch: BranchFilter;
  sort: InboxSort;
  onOpen: (groupId: string) => void;
}) {
  const today = dubaiToday();
  const { cards, isLoading, error } = useCards("open", null, name, branch);
  const open = useMemo(() => sortInbox(cards.filter((c) => !cardMissed(c, today)), sort), [cards, sort, today]);

  if (error) return <p className="text-sm text-red-700">Couldn't load requests: {(error as Error).message}</p>;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!open.length) {
    return (
      <EmptyCard>
        {name.trim() || branch !== "all" ? "Nothing matches that filter." : "Nothing waiting — start a New Request."}
      </EmptyCard>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium flex flex-wrap items-center gap-2">
        <span>Inbox</span>
        <Badge variant="secondary">{open.length}</Badge>
        <span className="text-xs font-normal text-muted-foreground">
          Everything still to act on — fill missing pieces, then approve or reject
        </span>
      </div>
      <div className="grid gap-2">
        {open.map((c) => (
          <RequestCardView key={c.groupId} card={c} onOpen={() => onOpen(c.groupId)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Requests we answered too late: the transport date passed before anyone approved or
 * rejected them — still unanswered, or answered only after the day. Grouped by the
 * requested date, newest first; answered-in-time requests never show here.
 */
function MissedView({ name, branch, onOpen }: { name: string; branch: BranchFilter; onOpen: (groupId: string) => void }) {
  const today = dubaiToday();
  const [from, setFrom] = useState(shiftIsoDate(today, -30));
  const [to, setTo] = useState(shiftIsoDate(today, -1));
  const range = { from: from <= to ? from : to, to: from <= to ? to : from };
  const { data, isLoading } = useTransportRequestRows("missed", range);

  const byDate = useMemo(() => {
    const late = (data ?? []).filter((r) => rowMissed(r, today));
    // One card per ask and requested day, so each late day is counted once.
    const m = new Map<string, Card_[]>();
    for (const card of groupRequests(late)) {
      if (!cardMatches(card, name) || !matchesBranch(card.branchId, branch)) continue;
      for (const d of card.dates) {
        const rows = card.rows.filter((r) => r.service_date === d);
        const status = rows.some((r) => r.status === "received") ? "received" : (rows[0].status as Card_["status"]);
        m.set(d, [...(m.get(d) ?? []), { ...card, rows, lead: rows[0], dates: [d], status }]);
      }
    }
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [data, today, name, branch]);

  const controls = (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Requested dates</span>
      <Input type="date" className="w-40" aria-label="Missed from" value={from} max={shiftIsoDate(today, -1)} onChange={(e) => setFrom(e.target.value)} />
      <span className="text-muted-foreground">to</span>
      <Input type="date" className="w-40" aria-label="Missed to" value={to} max={shiftIsoDate(today, -1)} onChange={(e) => setTo(e.target.value)} />
    </div>
  );

  if (isLoading) return <div className="space-y-4">{controls}<Skeleton className="h-64 w-full" /></div>;
  return (
    <div className="space-y-5">
      <p className="text-sm rounded-md border border-red-200 dark:border-red-800 p-2.5 text-red-700 dark:text-red-400">
        Requests we didn't answer in time: the requested day passed before they were approved or rejected — whether
        they are still waiting, or were answered late. Anything answered on or before its day, including same-day
        requests, is not listed.
      </p>
      {controls}
      {!byDate.length ? (
        <EmptyCard>
          {name.trim() || branch !== "all" ? "Nothing matches that filter." : "Nothing missed in those days — every request was answered before its date."}
        </EmptyCard>
      ) : (
        byDate.map(([date, list]) => (
          <div key={date} className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <span>{dayDate(date)}</span>
              <Badge variant="secondary">{list.length}</Badge>
            </div>
            <div className="grid gap-2">
              {list.map((c) => (
                <RequestCardView key={`${c.groupId}-${date}`} card={c} onOpen={() => onOpen(c.groupId)} missed />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** Agreed asks: upcoming travel day by day, or — switched to Past — days already gone. */
function ApprovedView({ name, branch, onOpen }: { name: string; branch: BranchFilter; onOpen: (groupId: string) => void }) {
  const today = dubaiToday();
  // Desk links here with ?needsTime=1&date= (AE): approved trips still without a time.
  const [params, setParams] = useSearchParams();
  const needsTimeOnly = params.get("needsTime") === "1";
  const dateFilter = params.get("date");
  const clearNeedsTime = () =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("needsTime");
      p.delete("date");
      return p;
    });
  const [period, setPeriod] = useState<"upcoming" | "past">(dateFilter && dateFilter < today ? "past" : "upcoming");
  const [pastFrom, setPastFrom] = useState(shiftIsoDate(today, -14));
  const [pastTo, setPastTo] = useState(shiftIsoDate(today, -1));
  const range =
    period === "past"
      ? { from: pastFrom <= pastTo ? pastFrom : pastTo, to: pastFrom <= pastTo ? pastTo : pastFrom }
      : { from: today };
  const { cards, isLoading } = useCards(period === "past" ? "past" : "approved", range, name, branch);

  // Dated cards go under each of their days; weekly ones (regulars, pauses, endings) together.
  const { byDate, weekly } = useMemo(() => {
    const m = new Map<string, Card_[]>();
    const weeklyCards: Card_[] = [];
    for (const c of cards) {
      if (needsTimeOnly && !cardNeedsTime(c)) continue;
      if (!c.dates.length) {
        if (!dateFilter) weeklyCards.push(c);
        continue;
      }
      for (const d of c.dates) {
        if (period === "upcoming" ? d < today : d < range.from || d > (range.to ?? d)) continue;
        if (dateFilter && d !== dateFilter) continue;
        m.set(d, [...(m.get(d) ?? []), c]);
      }
    }
    const days = [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { byDate: period === "past" ? days.reverse() : days, weekly: period === "past" ? [] : weeklyCards };
  }, [cards, period, today, range.from, range.to, needsTimeOnly, dateFilter]);

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      {(needsTimeOnly || dateFilter) && (
        <p className="w-full text-sm rounded-md border border-amber-200 dark:border-amber-800 p-2.5 text-amber-700 dark:text-amber-400" data-testid="transport-requests-needs-time-banner">
          {needsTimeOnly ? "Approved requests" : "Approved requests"}
          {dateFilter ? ` for ${dayDate(dateFilter)}` : ""}
          {needsTimeOnly ? " that still need a time — the van can't be planned until a slot is set." : "."}{" "}
          <button type="button" className="underline" onClick={clearNeedsTime}>
            Show all
          </button>
        </p>
      )}
      <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={(v) => v && setPeriod(v as typeof period)}>
        <ToggleGroupItem value="upcoming">Upcoming</ToggleGroupItem>
        <ToggleGroupItem value="past">Past</ToggleGroupItem>
      </ToggleGroup>
      {period === "past" && (
        <div className="flex items-center gap-2 text-sm">
          <Input type="date" className="w-40" aria-label="Past trips from" value={pastFrom} max={shiftIsoDate(today, -1)} onChange={(e) => setPastFrom(e.target.value)} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="w-40" aria-label="Past trips to" value={pastTo} max={shiftIsoDate(today, -1)} onChange={(e) => setPastTo(e.target.value)} />
        </div>
      )}
    </div>
  );

  if (isLoading) return <div className="space-y-4">{controls}<Skeleton className="h-64 w-full" /></div>;
  if (!byDate.length && !weekly.length) {
    return (
      <div className="space-y-4">
        {controls}
        <EmptyCard>
          {name.trim() || branch !== "all"
            ? "Nothing matches that filter."
            : period === "past"
              ? "No approved trips in those days."
              : "No approved upcoming trips. Approved requests appear here until their day has passed."}
        </EmptyCard>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {controls}
      {weekly.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <span>Regular changes</span>
            <Badge variant="secondary">{weekly.length}</Badge>
            <span className="text-xs font-normal text-muted-foreground">New regulars, pauses and endings — applied to Regulars</span>
          </div>
          <div className="grid gap-2">
            {[...weekly]
              .sort((a, b) => (cardFirstDate(a) ?? "").localeCompare(cardFirstDate(b) ?? ""))
              .map((c) => (
                <RequestCardView key={c.groupId} card={c} onOpen={() => onOpen(c.groupId)} approved />
              ))}
          </div>
        </div>
      )}
      {byDate.map(([date, list]) => (
        <div key={date} className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <span>
              {date === today ? "Today · " : ""}
              {dayDate(date)}
            </span>
            <Badge variant="secondary">{list.length}</Badge>
          </div>
          <div className="grid gap-2">
            {list.map((c) => (
              <RequestCardView key={`${c.groupId}-${date}`} card={c} onOpen={() => onOpen(c.groupId)} approved />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RequestCardView({
  card,
  onOpen,
  approved = false,
  missed = false,
}: {
  card: Card_;
  onOpen: () => void;
  approved?: boolean;
  missed?: boolean;
}) {
  const needsTime = cardNeedsTime(card) && !missed;
  const late = missed ? Math.max(...card.rows.map(daysLate)) : 0;
  const note = card.rows.map((r) => r.notes).find((n) => n?.trim());
  const review = card.rows.find((r) => r.needs_review);
  return (
    // A div, not a button: the trip-note editor inside is a button of its own.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      data-testid="transport-request-card"
      className={`w-full text-left rounded-lg border bg-card p-3 hover:ring-2 hover:ring-primary/50 transition cursor-pointer ${
        review || (needsTime && !approved) ? "border-amber-300 dark:border-amber-700" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium capitalize truncate">
          <RequestPetNames rows={card.rows} />
          {card.ownerName && <span className="text-muted-foreground font-normal"> · {card.ownerName}</span>}
        </p>
        <span className="flex items-center gap-1.5 shrink-0">
          <TripNoteButton requestIds={card.rows.map((r) => r.id)} note={note ?? null} />
          <BranchBadge branchId={card.branchId} />
          {review && <Badge variant="outline" className={TONE_BADGE.warn}>Needs review</Badge>}
          {needsTime && <Badge variant="outline" className={TONE_BADGE.warn}>Time not set</Badge>}
          <Badge variant="outline" className={TONE_BADGE[kindTone(card.kind, card.lead.purpose)]}>{kindLabel(card.kind, card.lead.purpose)}</Badge>
          <Badge variant="outline" className={TONE_BADGE[statusTone(card.status)]}>{statusLabel(card.status)}</Badge>
        </span>
      </div>
      <p className="text-sm text-muted-foreground mt-1">{cardSummary(card)}</p>
      {review?.review_reason && <p className={`text-sm mt-1 ${TONE_TEXT.warn}`}>{review.review_reason}</p>}
      {missed && (
        <p className={`text-sm mt-1 ${TONE_TEXT.critical}`} data-testid="transport-request-missed-reason">
          {card.status === "received"
            ? "Not answered yet — the date has passed"
            : `${statusLabel(card.status)} ${late} day${late === 1 ? "" : "s"} after the requested date${
                card.lead.decided_by ? ` by ${card.lead.decided_by}` : ""
              }${card.lead.decided_at ? ` (${dayDate(dubaiDay(card.lead.decided_at))})` : ""}`}
        </p>
      )}
      {card.kind === "cancel" && approved && (
        <p className={`text-sm mt-1 ${TONE_TEXT.critical}`}>
          {card.cadence === "regular" ? `regular ends after ${dayDate(card.lead.ends_on)}` : `cancels ${card.dates.map(dayDate).join(", ")}`}
        </p>
      )}
      {note && (
        <p className="text-sm mt-1 flex items-start gap-1">
          <StickyNote className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" aria-label="Note for this trip" />
          <span className="whitespace-pre-wrap">{note.trim()}</span>
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
        {card.lead.created_by ? ` · by ${card.lead.created_by}` : ""}
      </p>
    </div>
  );
}
