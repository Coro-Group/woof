import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, Check, Loader2, Sparkles, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { usePets } from "@/hooks/usePets";
import {
  hhmm,
  useAcceptRequestOffer,

  useBookByHand,
  useCurrentStaffName,
  useDecideTransportRequest,
  useOfferRequest,
  useAdoptVoltlinesHomePin,
  useRequestOffers,
  useSameDayConflicts,
  useTransportHubStatus,
  type SameDayConflict,
  type TransportRequestOffer,
  type TransportSlot,
  useSetTransportRequestPets,
  useTransportRequestGroup,
  useTransportSlots,
  useUpdateTransportRequestRows,
  type TransportRequestWithDetails,
} from "@/hooks/useTransport";
import { nextDateForWeekday } from "@/lib/transportRequests";
import { isPetDeceased } from "@/lib/petDeceased";
import { HALF_PAST_STARTS, WINDOW_LENGTH_MIN, dubaiToday, ownWindowLabel } from "@/lib/transportSchedule";

/** A one-off's time as the editor holds it: the slot id, or "<slot id>@<minute>" when it starts half past. */
const timeValueOf = (r: { requested_slot_id: string | null; window_start_min?: number | null; purpose?: string | null }) =>
  r.requested_slot_id && r.purpose === "regular" && r.window_start_min != null
    ? `${r.requested_slot_id}@${r.window_start_min}`
    : r.requested_slot_id ?? "";
import {
  REJECT_REASONS,
  SHORT_DAYS,
  TONE_BADGE,
  cardSummary,
  dayDate,
  groupRequests,
  isOpenStatus,
  kindLabel,
  kindTone,
  shortDate,
  statusLabel,
  statusTone,
} from "@/lib/transportRequests";
import { OwnerCombobox } from "@/components/daycare/DaycareOwnerCombobox";
import { BranchBadge, PinBadge, RequestPetNames, dipFirst } from "@/components/transport/transportShared";
import { TransportProfileStep } from "@/components/transport/TransportProfileStep";

import { OfferList, PromiseBox, VOLTLINES_QUOTE_NOTE, legLabel, storedToPanelOffers, useSameDayConfirm } from "@/components/transport/OfferPanel";
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
import { TONE } from "@/components/transport/status";

const ACTION_LABEL: Record<string, string> = {
  recorded: "Recorded",
  offered: "Offered",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Withdrawn",
  received: "Re-opened",
  note: "Note changed",
  edited: "Edited",
};

/**
 * One card, opened from the Requests list (AE's RequestDetailSheet): what they asked,
 * fix anything missing, then — as in AE — Offer (the transport hub quotes the hour
 * asked and the hours either side), Accept the option the customer takes, or Book by
 * hand when no quote is possible. Cancellations, pauses, moves and regulars approve.
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
  const voltlinesHome = useAdoptVoltlinesHomePin(owner);
  const homeLat = owner?.pin_lat ?? voltlinesHome?.lat ?? null;
  const homeLng = owner?.pin_lng ?? voltlinesHome?.lng ?? null;
  const open = isOpenStatus(card.status);
  const addition = card.kind === "one_off" || card.kind === "new_recurring";
  const ids = rows.map((r) => r.id);
  const openIds = rows.filter((r) => isOpenStatus(r.status)).map((r) => r.id);

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
    setSlotById(Object.fromEntries(rows.map((r) => [r.id, timeValueOf(r)])));
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
    rows.some((r) => (slotById[r.id] ?? "") !== timeValueOf(r) || (dateById[r.id] ?? "") !== (r.service_date ?? ""));

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
            requested_slot_id: (slotById[r.id] ?? "").split("@")[0] || null,
            // A home trip's own window follows the time picked: half past = that hour, else none.
            ...(r.purpose === "regular" && (r.service_date || r.kind === "new_recurring")
              ? (() => {
                  const half = (slotById[r.id] ?? "").includes("@") ? Number(slotById[r.id].split("@")[1]) : null;
                  return { window_start_min: half, window_end_min: half != null ? half + WINDOW_LENGTH_MIN : null };
                })()
              : {}),
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
  const noPin = addition && owner && homeLat == null && rows.every((r) => r.location_lat == null);

  /*
   * AE's Offer / Accept / Book by hand, for additions while the hub link is on: a dated
   * one-off is quoted against its day, a new regular against the Master base for each
   * weekday (its first date on or after the start). Cancellations, pauses, moves and vet /
   * branch-move legs still Approve.
   */
  const hub = useTransportHubStatus();
  const hubOn = !!hub.data?.enabled && !!hub.data?.configured && hub.data?.hub?.enabled === true;
  const offerable =
    hubOn && (card.kind === "one_off" || card.kind === "new_recurring") && (lead.purpose ?? "regular") === "regular";
  const offersQuery = useRequestOffers(ids);
  const offersByLeg = offersQuery.data ?? new Map<string, TransportRequestOffer[]>();
  const offerRequest = useOfferRequest();
  const bookByHand = useBookByHand();
  const sameDay = useSameDayConfirm();
  const openLegs = rows.filter((r) => isOpenStatus(r.status));
  const petById = new Map(ownerPets.map((p) => [p.id, p]));
  const notOnVoltlines = petIds.some((id) => !petById.get(id)?.voltlines_passenger_id);
  const pinless = !!noPin;
  const alreadyOffered = rows.some((r) => r.status === "offered");
  const legsWithoutTime = openLegs.filter((r) => !r.requested_slot_id);
  // Every option on every offered leg would push someone out: nothing here can accept it.
  const nothingToAccept =
    alreadyOffered && openLegs.every((r) => (offersByLeg.get(r.id) ?? []).every((o) => (o.displaces ?? 0) > 0));
  // No transport profile (or no pin) is fixed on the request, never booked around (23 Nov 2026).
  // Book by hand is left only for a day where every option would push someone out.
  const byHand = offerable && nothingToAccept && !(notOnVoltlines || pinless);
  const conflicts = useSameDayConflicts(
    lead.owner_id,
    petIds,
    openLegs.map((r) => r.service_date).filter((d): d is string => !!d),
    [...new Set(openLegs.map((r) => r.direction))],
    ids,
  );
  const sortedLegs = [...rows].sort(
    (a, b) =>
      (a.service_date ?? String(a.weekday)).localeCompare(b.service_date ?? String(b.weekday)) || (a.direction === "pickup" ? -1 : 1),
  );

  const runOffer = () => {
    const legs = openLegs
      .filter((r) => (r.service_date || r.weekday != null) && r.requested_slot_id)
      .map((r) => ({
        requestId: r.id,
        petId: r.transport_request_pet[0]?.pet_id ?? petIds[0],
        // A regular is quoted on the first day it runs, against that weekday's Master base.
        date: r.service_date ?? nextDateForWeekday(r.weekday as number, r.starts_on && r.starts_on > today ? r.starts_on : today),
        kind: r.kind === "new_recurring" ? ("new_recurring" as const) : ("one_off" as const),
        direction: r.direction as "pickup" | "dropoff",
        startMin: slots.find((sl) => sl.id === r.requested_slot_id)?.start_min ?? 0,
        ...(r.location_text && r.location_lat != null && r.location_lng != null
          ? { location: { label: r.location_text, lat: r.location_lat, lng: r.location_lng } }
          : {}),
      }));
    offerRequest.mutate(
      { legs, actor },
      {
        onSuccess: (results) => {
          const failed = results.find((x) => x.error);
          if (failed) toast.error(failed.error);
          else toast.success("Offers ready — accept the option the customer takes.");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const runBookByHand = () =>
    sameDay.ask(conflictMessages(conflicts), () =>
      bookByHand.mutate(
        {
          ids: openIds,
          actor,
          reason: notOnVoltlines
            ? "no Voltlines passenger"
            : pinless
              ? "no usable Voltlines pin"
              : "booked by hand — no offer could be accepted",
        },
        {
          onSuccess: () => {
            toast.success(
              notOnVoltlines
                ? "Booked. It is on the schedule, waiting on a Voltlines account."
                : pinless
                  ? "Booked. It is on the schedule, waiting on a usable Voltlines pin."
                  : "Booked. It is on the schedule.",
            );
            onDone();
          },
          onError: (e) => toast.error((e as Error).message),
        },
      ),
    );

  const trail = requestTrail(card.kind, card.status, lead);

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
                        {slotsFor(r.direction).flatMap((s) => [
                          <SelectItem key={s.id} value={s.id}>
                            {s.label}
                          </SelectItem>,
                          ...(r.purpose === "regular" && (r.service_date || r.kind === "new_recurring") && HALF_PAST_STARTS.includes(s.start_min + 30)
                            ? [
                                <SelectItem key={`${s.id}@30`} value={`${s.id}@${s.start_min + 30}`}>
                                  {ownWindowLabel(s.start_min + 30, s.start_min + 30 + WINDOW_LENGTH_MIN)}
                                </SelectItem>,
                              ]
                            : []),
                        ])}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-muted-foreground">
                      {(r.purpose === "regular" && r.window_start_min != null && r.window_end_min != null
                        ? ownWindowLabel(r.window_start_min, r.window_end_min)
                        : null) ??
                        r.transport_slots?.label ??
                        "No time set"}
                    </span>
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
          <PinBadge lat={homeLat} lng={homeLng} />

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
          {sameDay.dialog}
          {dirty && <p className="text-xs text-amber-700 dark:text-amber-400">Save your changes before approving.</p>}
          {offerable && legsWithoutTime.length > 0 && !dirty && (
            <p className={`text-xs ${TONE.warn.text}`}>Set the time they asked for on each trip above, save, then Offer.</p>
          )}
          {offerable && (notOnVoltlines || pinless) && owner && (
            <TransportProfileStep
              ownerId={ownerId}
              ownerName={ownerLabel || "the client"}
              address={owner.address ?? null}
              pinLat={homeLat}
              pinLng={homeLng}
              pets={petIds.map((id) => petById.get(id)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ id: p.id, name: p.name, voltlines_passenger_id: p.voltlines_passenger_id ?? null }))}
            />
          )}
          {!rejecting ? (
            <div className="flex flex-wrap gap-2">
              {!offerable && (
                <Button onClick={() => act("approve")} disabled={dirty || decide.isPending} data-testid="transport-request-approve">
                  {decide.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Approve
                </Button>
              )}
              {offerable && !(notOnVoltlines || pinless) && (
                <Button
                  onClick={runOffer}
                  disabled={dirty || offerRequest.isPending || legsWithoutTime.length > 0}
                  title={legsWithoutTime.length ? "Set the time they asked for first" : undefined}
                  data-testid="transport-request-offer"
                >
                  {offerRequest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {alreadyOffered ? "Offer again" : "Offer"}
                </Button>
              )}
              {byHand && (
                <Button
                  variant="secondary"
                  onClick={runBookByHand}
                  disabled={dirty || bookByHand.isPending}
                  data-testid="transport-request-book-by-hand"
                >
                  Book by hand
                </Button>
              )}
              <Button variant="outline" onClick={() => setRejecting(true)} disabled={decide.isPending} data-testid="transport-request-reject">
                <X className="mr-2 h-4 w-4" /> Request rejected
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
              <p className="text-sm font-medium">Why is this rejected?</p>
              <div className="flex flex-wrap gap-2">
                {[...REJECT_REASONS, "Other…"].map((r) => (
                  <Button key={r} size="sm" variant={reason === r ? "default" : "outline"} className="h-8 text-xs" onClick={() => setReason(r)}>
                    {r}
                  </Button>
                ))}
              </div>
              {reason === "Other…" && (
                <Input placeholder="Type the reason for the team…" value={otherReason} onChange={(e) => setOtherReason(e.target.value)} />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!reason || (reason === "Other…" && !otherReason.trim()) || decide.isPending}
                  onClick={() => act("reject", reason === "Other…" ? otherReason.trim() : reason)}
                  data-testid="transport-request-reject-confirm"
                >
                  Confirm rejection
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {(alreadyOffered || [...offersByLeg.values()].some((l) => l.length > 0) || rows.some((r) => r.promised_eta_min != null)) && (
        <section className="space-y-2" data-testid="transport-request-offers">
          <Separator />
          <h3 className="text-sm font-medium">Offers</h3>
          {sortedLegs.map((leg) => (
            <LegOffers
              key={leg.id}
              leg={leg}
              offers={offersByLeg.get(leg.id) ?? []}
              slots={slots}
              actor={actor}
              showLabel={rows.length > 1}
              conflicts={conflicts.filter((c) => c.date === leg.service_date && c.direction === leg.direction)}
            />
          ))}
          {alreadyOffered && (
            <p className="text-xs text-muted-foreground">
              {VOLTLINES_QUOTE_NOTE} Accepting records the promise against your name after the customer replies. Change the asked
              time above and Offer again if they need a different time.
            </p>
          )}
        </section>
      )}

      <section className="space-y-2">
        <Separator />
        <h3 className="text-sm font-medium">What happened</h3>
        {/* Who is answerable for each stage (AE requestTrail). */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm" data-testid="transport-request-trail">
          {trail.map((step) => (
            <Fragment key={step.label}>
              <dt className="text-muted-foreground">{step.label} by</dt>
              <dd className="min-w-0">
                {step.who ?? (step.at ? "Not recorded" : <span className="text-muted-foreground">Not yet</span>)}
                {step.at && <span className="text-xs text-muted-foreground"> · {format(new Date(step.at), "d MMM, h:mm a")}</span>}
              </dd>
            </Fragment>
          ))}
        </dl>
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

/** AE's same-day notice lines, for the "Approve and override" dialog. */
function conflictMessages(conflicts: SameDayConflict[]): string[] {
  return [
    ...new Set(
      conflicts.map(
        (c) =>
          `${c.petName} already has a ${c.direction === "pickup" ? "pickup" : "drop-off"}${c.time ? ` at ${c.time}` : ""} on ${dayDate(c.date)} (${c.source}).`,
      ),
    ),
  ];
}

type TrailStep = { label: string; who: string | null; at: string | null };

/** AE's requestTrail: Created by / Offered by / Approved by (or Rejected by). */
export function requestTrail(
  kind: string,
  status: string,
  lead: {
    created_by: string | null;
    created_at: string;
    offered_by?: string | null;
    offered_at?: string | null;
    decided_by: string | null;
    decided_at: string | null;
  },
): TrailStep[] {
  const steps: TrailStep[] = [{ label: "Created", who: lead.created_by, at: lead.created_at }];
  if (kind !== "cancel" && kind !== "pause") {
    steps.push({
      label: "Offered",
      who: lead.offered_by ?? (status === "received" ? null : "No offer sent"),
      at: lead.offered_at ?? null,
    });
  }
  if (status === "rejected") {
    steps.push({ label: "Rejected", who: lead.decided_by, at: lead.decided_at });
    return steps;
  }
  steps.push({
    label: "Approved",
    who: status === "approved" ? lead.decided_by : null,
    at: status === "approved" ? lead.decided_at : null,
  });
  return steps;
}

/**
 * One leg's offers (AE LegOffers): accept or decline per journey, so accepting the
 * drop-off's hour never carries the pickup's crossed-out options with it.
 */
function LegOffers({
  leg,
  offers,
  slots,
  actor,
  showLabel,
  conflicts,
}: {
  leg: TransportRequestWithDetails;
  offers: TransportRequestOffer[];
  slots: TransportSlot[];
  actor: string;
  showLabel: boolean;
  conflicts: SameDayConflict[];
}) {
  const [declined, setDeclined] = useState<string[]>([]);
  const accept = useAcceptRequestOffer();
  const sameDay = useSameDayConfirm();
  const panelOffers = storedToPanelOffers(offers);
  const interactive = leg.status === "offered";
  const settled = leg.status === "approved" && (leg.accepted_offer_id != null || leg.promised_eta_min != null);
  const chosen = settled ? panelOffers.find((o) => o.offerId === leg.accepted_offer_id) ?? null : null;

  return (
    <div className="space-y-1.5">
      {sameDay.dialog}
      {showLabel && <p className="text-xs font-medium text-foreground">{legLabel(leg)}</p>}
      {settled ? (
        <PromiseBox
          slotLabel={chosen?.slotLabel ?? null}
          eta={chosen?.eta ?? (leg.promised_eta_min != null ? hhmm(leg.promised_eta_min) : null)}
          acceptedAt={leg.decided_at}
        />
      ) : (
        <OfferList
          offers={panelOffers}
          declined={declined}
          onToggleDeclined={(id) => setDeclined((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]))}
          onAccept={(offerId) => {
            const offer = offers.find((o) => o.id === offerId);
            if (!offer) return;
            sameDay.ask(conflictMessages(conflicts), () =>
              accept.mutate(
                {
                  requestId: leg.id,
                  direction: leg.direction,
                  offer,
                  declinedOfferIds: declined.filter((d) => d !== offer.id),
                  slots,
                  actor,
                  kind: leg.kind,
                },
                {
                  onSuccess: (r) => toast.success(r.message),
                  onError: (e) => toast.error((e as Error).message),
                },
              ),
            );
          }}
          accepting={accept.isPending}
          readOnly={!interactive}
          emptyText={
            showLabel
              ? `No offers were stored for this leg — ${legLabel(leg).toLowerCase()}.`
              : "No offers were stored for this request."
          }
        />
      )}
    </div>
  );
}
