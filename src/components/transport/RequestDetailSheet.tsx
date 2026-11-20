import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, Check, Loader2, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { usePets } from "@/hooks/usePets";
import {
  useCurrentStaffName,
  useDecideTransportRequest,
  useSetTransportRequestPets,
  useTransportRequestGroup,
  useTransportSlots,
  useUpdateTransportRequestRows,
  type TransportRequestWithDetails,
} from "@/hooks/useTransport";
import { isPetDeceased } from "@/lib/petDeceased";
import { dubaiToday } from "@/lib/transportSchedule";
import {
  REJECT_REASONS,
  SHORT_DAYS,
  TONE_BADGE,
  cardSummary,
  dayDate,
  groupRequests,
  kindLabel,
  kindTone,
  shortDate,
  statusLabel,
  statusTone,
} from "@/lib/transportRequests";
import { OwnerCombobox } from "@/components/daycare/DaycareOwnerCombobox";
import { BranchBadge, PinBadge, RequestPetNames, dipFirst } from "@/components/transport/transportShared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";

const ACTION_LABEL: Record<string, string> = {
  recorded: "Recorded",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Withdrawn",
  received: "Re-opened",
  note: "Note changed",
  edited: "Edited",
};

/**
 * One card, opened from the Requests list: what they asked, fix anything missing,
 * then approve or reject.
 */
export function RequestDetailSheet({ groupId, onClose }: { groupId: string | null; onClose: () => void }) {
  const { data, isLoading } = useTransportRequestGroup(groupId);
  const card = useMemo(() => (data?.rows.length ? groupRequests(data.rows)[0] : null), [data]);

  return (
    <Sheet open={!!groupId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto" data-testid="transport-request-detail">
        {isLoading || !data ? (
          <Skeleton className="h-64 w-full mt-8" />
        ) : !card ? (
          <p className="mt-8 text-sm text-muted-foreground">This request is not available — it may belong to another branch.</p>
        ) : (
          <DetailBody key={groupId} rows={data.rows} events={data.events} onDone={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  rows,
  events,
  onDone,
}: {
  rows: TransportRequestWithDetails[];
  events: { id: string; at: string; actor: string | null; action: string; detail: string | null }[];
  onDone: () => void;
}) {
  const card = groupRequests(rows)[0];
  const lead = card.lead;
  const owner = lead.owners;
  const open = card.status === "received";
  const addition = card.kind === "one_off" || card.kind === "new_recurring";
  const ids = rows.map((r) => r.id);
  const openIds = rows.filter((r) => r.status === "received").map((r) => r.id);

  const { branches, branchLocked } = useBranch();
  const { data: slots = [] } = useTransportSlots();
  const { data: staffName } = useCurrentStaffName();
  const update = useUpdateTransportRequestRows();
  const setPets = useSetTransportRequestPets();
  const decide = useDecideTransportRequest();

  // Editable copy of the card.
  const [slotById, setSlotById] = useState<Record<string, string>>({});
  const [dateById, setDateById] = useState<Record<string, string>>({});
  const [branchId, setBranchId] = useState(card.branchId);
  const [note, setNote] = useState(rows.map((r) => r.notes).find((n) => n?.trim()) ?? "");
  const [ownerId, setOwnerId] = useState(lead.owner_id);
  const [ownerLabel, setOwnerLabel] = useState(card.ownerName);
  const [petIds, setPetIds] = useState<string[]>(() => [...new Set(rows.flatMap((r) => r.transport_request_pet.map((p) => p.pet_id)))]);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const { data: ownerPets = [] } = usePets(ownerId);

  useEffect(() => {
    setSlotById(Object.fromEntries(rows.map((r) => [r.id, r.requested_slot_id ?? ""])));
    setDateById(Object.fromEntries(rows.map((r) => [r.id, r.service_date ?? ""])));
  }, [rows]);

  const actor = staffName ?? "Staff";
  const petsChanged = useMemo(() => {
    const before = new Set(rows.flatMap((r) => r.transport_request_pet.map((p) => p.pet_id)));
    return ownerId !== lead.owner_id || petIds.length !== before.size || petIds.some((p) => !before.has(p));
  }, [rows, petIds, ownerId, lead.owner_id]);
  const dirty =
    petsChanged ||
    branchId !== card.branchId ||
    note.trim() !== (rows.map((r) => r.notes).find((n) => n?.trim()) ?? "").trim() ||
    rows.some((r) => (slotById[r.id] ?? "") !== (r.requested_slot_id ?? "") || (dateById[r.id] ?? "") !== (r.service_date ?? ""));

  const saveEdits = async () => {
    try {
      if (petsChanged) {
        if (petIds.length === 0) return toast.error("Pick at least one dog");
        if (ownerId !== lead.owner_id) await update.mutateAsync({ ids, patch: { owner_id: ownerId, updated_by: actor } });
        await setPets.mutateAsync({ ids, petIds });
      }
      const common = { updated_by: actor, notes: note.trim() || null, branch_id: branchId };
      for (const r of rows) {
        await update.mutateAsync({
          ids: [r.id],
          patch: {
            ...common,
            requested_slot_id: slotById[r.id] || null,
            ...(r.service_date ? { service_date: dateById[r.id] || r.service_date } : {}),
          },
        });
      }
      toast.success("Saved");
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save");
    }
  };

  const act = (action: "approve" | "reject" | "cancel", why?: string) =>
    decide.mutate(
      { ids: openIds, action, actor, reason: why },
      {
        onSuccess: (n) => {
          toast.success(
            action === "approve"
              ? card.kind === "new_recurring"
                ? "Approved — added to Regulars"
                : card.kind === "pause"
                  ? "Approved — regular paused"
                  : card.kind === "cancel" && card.cadence === "regular"
                    ? "Approved — regular ends on its last day"
                    : "Approved"
              : action === "reject"
                ? "Rejected"
                : "Withdrawn",
          );
          if (n) onDone();
        },
        onError: (err) => toast.error((err as Error).message || "Couldn't update the request"),
      },
    );

  const slotsFor = (direction: string) => slots.filter((s) => s.direction === direction);
  const today = dubaiToday();
  const noPin = addition && owner && owner.pin_lat == null && rows.every((r) => r.location_lat == null);

  return (
    <div className="space-y-5 pb-8">
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2 pr-6">
          <RequestPetNames rows={card.rows} variant="pill" className="capitalize" />
          {owner && (
            <Link to={`/customers/${lead.owner_id}`} className="text-muted-foreground font-normal hover:underline">
              · {card.ownerName}
            </Link>
          )}
        </SheetTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <BranchBadge branchId={card.branchId} />
          <Badge variant="outline" className={TONE_BADGE[kindTone(card.kind, card.lead.purpose)]}>{kindLabel(card.kind, card.lead.purpose)}</Badge>
          <Badge variant="outline" className={TONE_BADGE[statusTone(card.status)]} data-testid="transport-request-detail-status">
            {statusLabel(card.status)}
          </Badge>
        </div>
      </SheetHeader>

      {card.status === "rejected" && lead.rejection_reason && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 p-3 text-sm">
          <span className="font-medium">Rejected</span> · {lead.rejection_reason}
          {lead.decided_by ? ` — ${lead.decided_by}` : ""}
        </div>
      )}
      {noPin && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            No usable pin — the van can't be routed. Add the home pin on the{" "}
            <Link className="underline" to={`/customers/${lead.owner_id}`}>
              customer's profile
            </Link>
            .
          </span>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">What they asked</h3>
        <p className="text-sm">{cardSummary(card)}</p>
        {lead.purpose === "transfer" && (
          <div className="space-y-2 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 p-2 text-xs text-teal-700 dark:text-teal-400">
            <p>
              A branch move{lead.notes ? ` — ${lead.notes}` : ""}. It is on the vans as booked; which van takes it is the
              transport team's call.
            </p>
            {card.status === "approved" && (lead.service_date ?? "") >= today && (
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                data-testid="transport-branch-move-cancel"
                onClick={() =>
                  window.confirm("Cancel this branch move? The dog's other trips that day are not changed.") &&
                  update.mutate(
                    {
                      ids: rows.map((r) => r.id),
                      patch: { status: "cancelled", decided_by: actor, decided_at: new Date().toISOString(), updated_by: actor },
                    },
                    {
                      onSuccess: () => {
                        toast.success("Branch move cancelled");
                        onDone();
                      },
                      onError: (e) => toast.error((e as Error).message),
                    },
                  )
                }
              >
                Cancel branch move
              </Button>
            )}
          </div>
        )}
        {lead.purpose === "vet" && (
          <p className="text-xs rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 p-2 text-sky-700 dark:text-sky-400">
            A leg of a vet visit{lead.notes ? ` — ${lead.notes}` : ""}. Change its times or cancel it from Desk → Vet visits, so
            the other legs move with it.
          </p>
        )}
        {rows.some((r) => r.needs_review) && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 dark:border-amber-800 p-2 text-xs text-amber-700 dark:text-amber-400">
            <span>Needs review · {rows.find((r) => r.needs_review)?.review_reason ?? "flagged"}</span>
            <button
              type="button"
              className="underline"
              onClick={() =>
                update.mutate(
                  { ids, patch: { needs_review: false, review_reason: null, updated_by: actor } },
                  { onSuccess: () => toast.success("Review flag cleared"), onError: (e) => toast.error((e as Error).message) },
                )
              }
            >
              Mark reviewed
            </button>
          </div>
        )}
        {open && !rows.some((r) => r.needs_review) && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => {
              const why = window.prompt("What needs checking?")?.trim();
              if (why) update.mutate({ ids, patch: { needs_review: true, review_reason: why, updated_by: actor } });
            }}
          >
            Flag for review
          </button>
        )}
        <div className="rounded-md border divide-y">
          {[...rows]
            .sort((a, b) => (a.service_date ?? String(a.weekday)).localeCompare(b.service_date ?? String(b.weekday)) || a.direction.localeCompare(b.direction))
            .map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 p-2.5 text-sm" data-testid="transport-request-detail-row">
                <Badge variant="outline" className="text-xs">{r.direction === "pickup" ? "Pickup" : "Drop-off"}</Badge>
                {r.service_date ? (
                  open ? (
                    <Input
                      type="date"
                      className="h-8 w-40"
                      min={card.kind === "cancel" ? today : undefined}
                      value={dateById[r.id] ?? r.service_date}
                      onChange={(e) => setDateById((p) => ({ ...p, [r.id]: e.target.value }))}
                    />
                  ) : (
                    <span>{dayDate(r.service_date)}</span>
                  )
                ) : (
                  <span>Every {r.weekday != null ? SHORT_DAYS[r.weekday] : "—"}</span>
                )}
                {addition &&
                  (open ? (
                    <Select value={slotById[r.id] ?? ""} onValueChange={(v) => setSlotById((p) => ({ ...p, [r.id]: v }))}>
                      <SelectTrigger className="h-8 w-36" data-testid="transport-request-detail-slot">
                        <SelectValue placeholder="No time yet" />
                      </SelectTrigger>
                      <SelectContent>
                        {slotsFor(r.direction).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground">{r.transport_slots?.label ?? "No time set"}</span>
                  ))}
                {r.location_text && <span className="text-xs text-muted-foreground">at {r.location_text}</span>}
                {r.status !== card.status && (
                  <Badge variant="outline" className={`text-xs ${TONE_BADGE[statusTone(r.status)]}`}>{statusLabel(r.status)}</Badge>
                )}
              </div>
            ))}
        </div>
        {card.kind === "new_recurring" && lead.starts_on && <p className="text-xs text-muted-foreground">Starts {shortDate(lead.starts_on)}</p>}
        <p className="text-xs text-muted-foreground">
          Recorded {format(new Date(card.createdAt), "d MMM, HH:mm")}
          {lead.created_by ? ` by ${lead.created_by}` : ""}
        </p>
      </section>

      {owner && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <PinBadge lat={owner.pin_lat} lng={owner.pin_lng} />
          {owner.phone && <span className="text-muted-foreground">{owner.phone}</span>}
          {owner.transport_notes?.trim() && (
            <span>
              <span className="font-medium">Household: </span>
              {owner.transport_notes}
            </span>
          )}
        </div>
      )}

      {open && (
        <section className="space-y-3">
          <Separator />
          <h3 className="text-sm font-medium">Customer and dogs</h3>
          <OwnerCombobox
            selectedId={ownerId}
            selectedLabel={ownerLabel}
            onSelect={(id, label) => {
              if (id !== ownerId && !window.confirm("Change the customer on this request? The dogs will need picking again.")) return;
              setOwnerId(id);
              setOwnerLabel(label);
              setPetIds([]);
            }}
            onClear={() => {}}
          />
          <div className="flex flex-wrap gap-3">
            {ownerPets.filter((p) => !isPetDeceased(p)).map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={petIds.includes(p.id)}
                  onCheckedChange={(v) => setPetIds((cur) => (v ? [...cur, p.id] : cur.filter((x) => x !== p.id)))}
                />
                {p.name}
                <VaccineStatusBadge petId={p.id} />
              </label>
            ))}
          </div>
          {!branchLocked && (
            <div className="space-y-1">
              <Label className="text-xs">Branch</Label>
              <ToggleGroup type="single" variant="outline" size="sm" value={branchId} onValueChange={(v) => v && setBranchId(v)} className="justify-start">
                {dipFirst(branches).map((b) => (
                  <ToggleGroupItem key={b.id} value={b.id}>
                    {b.short_name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <Label htmlFor="trip-note" className="flex items-center gap-1">
          <StickyNote className="h-3.5 w-3.5" /> Note for this trip
        </Label>
        <Textarea
          id="trip-note"
          rows={2}
          value={note}
          placeholder="Anything the driver or reception needs to know"
          onChange={(e) => setNote(e.target.value)}
          disabled={card.status === "rejected" || card.status === "cancelled"}
        />
      </section>

      {(dirty || open) && (
        <Button variant="outline" onClick={saveEdits} disabled={!dirty || update.isPending || setPets.isPending} data-testid="transport-request-detail-save">
          {(update.isPending || setPets.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      )}

      {open && (
        <section className="space-y-3">
          <Separator />
          {dirty && <p className="text-xs text-amber-700 dark:text-amber-400">Save your changes before approving.</p>}
          {!rejecting ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => act("approve")} disabled={dirty || decide.isPending} data-testid="transport-request-approve">
                {decide.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Approve
              </Button>
              <Button variant="outline" onClick={() => setRejecting(true)} disabled={decide.isPending} data-testid="transport-request-reject">
                <X className="mr-2 h-4 w-4" /> Reject
              </Button>
              <Button
                variant="ghost"
                onClick={() => window.confirm("Withdraw this request? Use this when it was entered by mistake.") && act("cancel")}
                disabled={decide.isPending}
              >
                Withdraw
              </Button>
            </div>
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Request rejected — why?</p>
              <div className="flex flex-wrap gap-2">
                {[...REJECT_REASONS, "Other…"].map((r) => (
                  <Button key={r} size="sm" variant={reason === r ? "default" : "outline"} className="h-8 text-xs" onClick={() => setReason(r)}>
                    {r}
                  </Button>
                ))}
              </div>
              {reason === "Other…" && (
                <Input placeholder="What happened" value={otherReason} onChange={(e) => setOtherReason(e.target.value)} />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!reason || (reason === "Other…" && !otherReason.trim()) || decide.isPending}
                  onClick={() => act("reject", reason === "Other…" ? otherReason.trim() : reason)}
                  data-testid="transport-request-reject-confirm"
                >
                  Reject request
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <Separator />
        <h3 className="text-sm font-medium">What happened</h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-1 text-xs" data-testid="transport-request-history">
            {dedupeEvents(events).map((e) => (
              <li key={e.id} className="flex flex-wrap gap-2">
                <span className="text-muted-foreground w-28 shrink-0">{format(new Date(e.at), "d MMM, HH:mm")}</span>
                <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.actor && <span className="text-muted-foreground">by {e.actor}</span>}
                {e.detail && <span className="text-muted-foreground">· {e.detail}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** A card's rows change together; show each change once, not once per row. */
function dedupeEvents<T extends { at: string; action: string; actor: string | null; detail: string | null }>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.at.slice(0, 19)}|${e.action}|${e.actor}|${e.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
