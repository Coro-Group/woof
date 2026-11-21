import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useCreateOwner, useOwner, useOwners } from "@/hooks/useOwners";
import { useCreatePet, usePets } from "@/hooks/usePets";
import {
  useAdoptVoltlinesHomePin,
  useCurrentStaffName,
  useRecordTransportRequest,
  useBoardingStaysFor,
  useTransportSlots,
  minutesOf,
  storeFormOffers,
  type TransportRequestInsert,
} from "@/hooks/useTransport";
import { isPetDeceased } from "@/lib/petDeceased";
import { boardingClashes, dubaiToday } from "@/lib/transportSchedule";
import { SHORT_DAYS, dayDate, nextDay, shortDate } from "@/lib/transportRequests";
import { useSameDayConflicts } from "@/hooks/useTransport";
import { HubOfferTimes, type AcceptedOffer } from "@/components/transport/HubOfferTimes";
import { PinField, emptyPin, pinReady, type PinDraft } from "@/components/transport/PinField";
import { VoltlinesPetLink } from "@/components/transport/VoltlinesPetLink";
import { TONE } from "@/components/transport/status";
import { PinBadge, dipFirst } from "@/components/transport/transportShared";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Record a transport request — a port of AE's ManualRequestForm.
 *
 * It records what the customer asked for and stops; reception approves it from the
 * Inbox. Two questions, in the order staff hear them: is this adding transport or
 * calling it off, and is it about particular dates or the regular pattern?
 */
const DIRECTIONS = [
  { value: "pickup", label: "Pickup" },
  { value: "dropoff", label: "Dropoff" },
] as const;
type Direction = (typeof DIRECTIONS)[number]["value"];

type LocationDraft = { enabled: boolean; text: string; pin: PinDraft };
const emptyLocation = (): LocationDraft => ({ enabled: false, text: "", pin: emptyPin() });
// Somewhere else needs words for the board; a pin is optional but must be usable if given.
const locationReady = (l: LocationDraft) =>
  !l.enabled || (!!l.text.trim() && (l.pin.status === "idle" ? !l.pin.text.trim() : pinReady(l.pin)));

export function RequestForm({
  onSaved,
  fixedOwner = null,
}: {
  onSaved?: () => void;
  fixedOwner?: { id: string; label: string } | null;
}) {
  const today = dubaiToday();
  const { branchId: activeBranchId, branches, branchLocked } = useBranch();
  const [action, setAction] = useState<"add" | "cancel" | "move">("add");
  const [moveFrom, setMoveFrom] = useState(today);
  const [moveTo, setMoveTo] = useState(nextDay(today));
  const [acceptConflicts, setAcceptConflicts] = useState(false);
  const [cadence, setCadence] = useState<"one_off" | "regular" | "pause">("one_off");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [pauseFrom, setPauseFrom] = useState(today);
  const [pauseUntil, setPauseUntil] = useState("");
  const [directions, setDirections] = useState<Direction[]>(["pickup"]);
  const [serviceDates, setServiceDates] = useState<string[]>([today]);
  const [weekdays, setWeekdays] = useState<string[]>([]);
  const [slotByDirection, setSlotByDirection] = useState<Partial<Record<Direction, string>>>({});
  // An offer from the transport hub a person accepted (AE OfferList "Accept"), per way.
  const [acceptedByDirection, setAcceptedByDirection] = useState<Partial<Record<Direction, AcceptedOffer>>>({});
  const [locationByDirection, setLocationByDirection] = useState<Record<Direction, LocationDraft>>({
    pickup: emptyLocation(),
    dropoff: emptyLocation(),
  });
  const [branchId, setBranchId] = useState<string | null>(activeBranchId);
  const [notes, setNotes] = useState("");

  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(fixedOwner?.id ?? null);
  const [ownerLabel, setOwnerLabel] = useState(fixedOwner?.label ?? "");
  const [selectedPetIds, setSelectedPetIds] = useState<string[]>([]);
  const [creatingOwner, setCreatingOwner] = useState(false);
  const [newOwnerFirst, setNewOwnerFirst] = useState("");
  const [newOwnerLast, setNewOwnerLast] = useState("");
  const [newOwnerPhone, setNewOwnerPhone] = useState("");
  const [newPetName, setNewPetName] = useState("");

  const owners = useOwners(ownerSearch.trim().length >= 1 ? ownerSearch : undefined);
  const { data: owner } = useOwner(ownerId ?? "");
  const { data: petsRaw = [], isLoading: petsLoading } = usePets(ownerId ?? "");
  const pets = petsRaw.filter((p) => !isPetDeceased(p));
  /** Selected dogs the vans cannot see yet — AE names them rather than failing later. */
  const voltlinesHome = useAdoptVoltlinesHomePin(owner?.id === ownerId ? owner : null);
  const homeLat = owner?.id === ownerId ? owner.pin_lat ?? voltlinesHome?.lat ?? null : null;
  const homeLng = owner?.id === ownerId ? owner.pin_lng ?? voltlinesHome?.lng ?? null : null;
  const homeAddress = owner?.id === ownerId ? owner.address?.trim() || voltlinesHome?.address?.trim() || "" : "";
  const missingVoltlines = pets.filter((p) => selectedPetIds.includes(p.id) && !p.voltlines_passenger_id);
  const slots = useTransportSlots();
  const createOwner = useCreateOwner();
  const createPet = useCreatePet();
  const record = useRecordTransportRequest();
  const { data: staffName } = useCurrentStaffName();

  // A locked receptionist records for their own branch only.
  useEffect(() => {
    if (branchLocked || !branchId) setBranchId(activeBranchId);
  }, [activeBranchId, branchLocked]);

  // One-dog households: tick the dog.
  useEffect(() => {
    if (pets.length === 1) setSelectedPetIds([pets[0].id]);
  }, [ownerId, pets.length]);

  const slotsFor = useMemo(() => {
    const by = new Map<string, NonNullable<typeof slots.data>>();
    for (const s of slots.data ?? []) by.set(s.direction, [...(by.get(s.direction) ?? []), s]);
    return (d: Direction) => by.get(d) ?? [];
  }, [slots.data]);

  const isMove = action === "move";
  const isCancellation = action === "cancel";
  const isPause = isCancellation && cadence === "pause";
  const isRegular = !isMove && cadence === "regular";
  const isWeekly = isRegular || isPause;
  const kind = isMove ? "change" : isPause ? "pause" : isCancellation ? "cancel" : isRegular ? "new_recurring" : "one_off";
  const pauseReady = !isPause || (!!pauseUntil && !!pauseFrom && pauseUntil >= pauseFrom);
  const datesChosen = isMove ? (moveTo ? [moveTo] : []) : [...new Set(serviceDates.filter(Boolean))].sort();
  const moveReady = !isMove || (!!moveFrom && !!moveTo && moveFrom !== moveTo);
  const allowsLocation = !isCancellation && !isWeekly;
  // AE's same-day notice: an addition for a dog already on the vans that day and way.
  const conflicts = useSameDayConflicts(
    ownerId,
    selectedPetIds,
    !isCancellation && !isWeekly ? datesChosen : [],
    directions,
  );
  const conflictsAcknowledged = conflicts.length === 0 || acceptConflicts;
  // A new clash needs its own say-so.
  useEffect(() => setAcceptConflicts(false), [conflicts.length]);
  // An accepted offer was for one dog on one day: a different dog or day starts over.
  useEffect(() => setAcceptedByDirection({}), [selectedPetIds.join(","), datesChosen.join(",")]);
  const locationsReady = !allowsLocation || directions.every((d) => locationReady(locationByDirection[d]));
  /*
   * A one-off a boarding stay would pause: the board strikes it, so no van comes (AE).
   * Said while the direction can still be changed — usually a checkout booked as a
   * pickup when the dog needs a drop-off home. A trip to another address still runs.
   */
  const checksBoarding = !isCancellation && !isWeekly;
  const boardingStays = useBoardingStaysFor(checksBoarding ? selectedPetIds : [], datesChosen);
  const clashes = checksBoarding
    ? boardingClashes(
        selectedPetIds,
        datesChosen,
        directions.filter((d) => !locationByDirection[d]?.enabled),
        boardingStays.data ?? [],
      )
    : [];
  const petName = (petId: string) => pets.find((p) => p.id === petId)?.name ?? "This dog";
  const branchShort = branches.find((b) => b.id === branchId)?.short_name ?? "";

  const reset = () => {
    setAction("add");
    setCadence("one_off");
    setDirections(["pickup"]);
    setServiceDates([today]);
    setWeekdays([]);
    setStartDate(today);
    setEndDate(today);
    setPauseFrom(today);
    setPauseUntil("");
    setSlotByDirection({});
    setAcceptedByDirection({});
    setLocationByDirection({ pickup: emptyLocation(), dropoff: emptyLocation() });
    setNotes("");
    setOwnerSearch("");
    if (!fixedOwner) {
      setOwnerId(null);
      setOwnerLabel("");
    }
    setSelectedPetIds([]);
  };

  const pickOwner = (id: string | null, label: string) => {
    setOwnerId(id);
    setOwnerLabel(label);
    setSelectedPetIds([]);
  };

  const saveNewOwner = async () => {
    if (!newOwnerFirst.trim() || !newPetName.trim()) {
      toast.error("A first name and a dog name are the minimum.");
      return;
    }
    try {
      const created = await createOwner.mutateAsync({
        first_name: newOwnerFirst.trim(),
        last_name: newOwnerLast.trim() || null,
        phone: newOwnerPhone.trim() || null,
      });
      const pet = await createPet.mutateAsync({ owner_id: created.id, name: newPetName.trim(), species: "dog" });
      pickOwner(created.id, `${created.first_name} ${created.last_name ?? ""}`.trim());
      setSelectedPetIds([pet.id]);
      setCreatingOwner(false);
      setNewOwnerFirst("");
      setNewOwnerLast("");
      setNewOwnerPhone("");
      setNewPetName("");
      toast.success("Customer created and selected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create that customer");
    }
  };

  const canSave =
    !!ownerId &&
    !!branchId &&
    selectedPetIds.length > 0 &&
    (isWeekly ? weekdays.length > 0 : datesChosen.length > 0) &&
    pauseReady &&
    moveReady &&
    conflictsAcknowledged &&
    directions.length > 0 &&
    locationsReady &&
    !record.isPending;

  const save = () => {
    if (!canSave) return;
    const who = staffName ?? null;
    const base = {
      branch_id: branchId!,
      owner_id: ownerId!,
      kind,
      cadence: isCancellation && !isPause ? (cadence as "one_off" | "regular") : null,
      notes: notes.trim() || null,
      created_by: who,
      updated_by: who,
      starts_on: kind === "new_recurring" ? startDate || today : null,
      ends_on: kind === "cancel" && isRegular ? endDate || today : null,
      paused_from: isPause ? pauseFrom || today : null,
      paused_until: isPause ? pauseUntil : null,
      from_date: isMove ? moveFrom : null,
    };
    const ownerHasPin = homeLat != null && homeLng != null;
    const rows: Omit<TransportRequestInsert, "group_id">[] = [];
    for (const direction of directions) {
      const loc = locationByDirection[direction];
      const hasOwnLocation = allowsLocation && loc.enabled && pinReady(loc.pin);
      // Flag it for review when the van would have nowhere to go (AE's needs_review).
      const noPin = !isCancellation && !isPause && !ownerHasPin && !hasOwnLocation;
      const legFields = {
        direction,
        requested_slot_id: !isCancellation && !isPause ? slotByDirection[direction] || null : null,
        location_text: allowsLocation && loc.enabled ? loc.text.trim() : null,
        location_lat: hasOwnLocation ? loc.pin.pin!.lat : null,
        location_lng: hasOwnLocation ? loc.pin.pin!.lng : null,
        needs_review: noPin,
        review_reason: noPin ? "No home pin — the van can't be routed" : null,
      };
      /*
       * An accepted hub offer is AE's accept: the promise is recorded against this
       * person and the trip is approved, with the promise on the trip's note
       * ("Promised: 08-09AM — collected around 08:20").
       */
      const offer = !isWeekly && datesChosen.length === 1 ? acceptedByDirection[direction] : undefined;
      const slot = offer ? slotsFor(direction).find((s) => s.start_min === offer.startMin) ?? null : null;
      const etaMin = offer?.eta ? minutesOf(offer.eta) : null;
      const now = new Date().toISOString();
      const promised = offer
        ? {
            status: "approved" as const,
            decided_by: who,
            decided_at: now,
            offered_by: who,
            offered_at: now,
            promised_slot_id: slot?.id ?? null,
            promised_window_start_min: slot?.start_min ?? (etaMin != null ? Math.max(0, etaMin - 30) : null),
            promised_window_end_min: slot?.end_min ?? (etaMin != null ? Math.min(1439, etaMin + 30) : null),
            promised_eta_min: etaMin,
          }
        : {};
      if (isWeekly) {
        for (const day of weekdays) rows.push({ ...base, ...legFields, weekday: Number(day), service_date: null });
      } else {
        for (const date of datesChosen) rows.push({ ...base, ...legFields, ...promised, service_date: date, weekday: null });
      }
    }
    record.mutate(
      { rows, petIds: selectedPetIds },
      {
        onSuccess: ({ groupId }) => {
          // The options and the chosen one, stored as an Inbox Offer / Accept stores them.
          const toStore = Object.fromEntries(
            Object.entries(acceptedByDirection).filter(([, o]) => !!o && !isWeekly && datesChosen.length === 1),
          ) as Partial<Record<Direction, AcceptedOffer>>;
          if (Object.keys(toStore).length) {
            storeFormOffers(groupId, toStore, who).catch((e: Error) =>
              toast.error(`Saved, but the offers were not stored: ${e.message}`),
            );
          }
          const allPromised = rows.length > 0 && rows.every((r) => r.status === "approved");
          toast.success(
            allPromised
              ? "Promise recorded and approved"
              : isMove
              ? "Move recorded — approve it from the Inbox"
              : isCancellation
                ? isPause ? "Pause recorded — approve it from the Inbox" : "Cancellation recorded — approve it from the Inbox"
                : "Request recorded — approve it from the Inbox",
          );
          reset();
          onSaved?.();
        },
        onError: (error: Error) => toast.error(error.message),
      },
    );
  };

  const dayNames = weekdays.map((d) => SHORT_DAYS[Number(d)]).join(", ");

  return (
    <div className="space-y-5" data-testid="transport-request-form">
      <div className="space-y-2">
        <Label>Request type</Label>
        <ToggleGroup
          type="single"
          value={action}
          onValueChange={(value) => {
            if (!value) return;
            setAction(value as typeof action);
            if (value === "add" && cadence === "pause") setCadence("regular");
          }}
          variant="outline"
          size="sm"
          className="justify-start"
        >
          <ToggleGroupItem value="add" data-testid="transport-request-add">Additions</ToggleGroupItem>
          <ToggleGroupItem value="cancel" data-testid="transport-request-cancel">Cancellations</ToggleGroupItem>
          <ToggleGroupItem value="move" data-testid="transport-request-move">Move a trip</ToggleGroupItem>
        </ToggleGroup>
        {isMove && (
          <p className="text-xs text-muted-foreground">
            Moves a trip to another day (and time). Once approved, the old day's trip is crossed out and the new one is on
            the board.
          </p>
        )}
        {!isMove && <ToggleGroup
          type="single"
          value={cadence}
          onValueChange={(value) => value && setCadence(value as typeof cadence)}
          variant="outline"
          size="sm"
          className="justify-start"
        >
          <ToggleGroupItem value="one_off" data-testid="transport-request-cadence-one-off">
            {isCancellation ? "Cancel day(s)" : "One off"}
          </ToggleGroupItem>
          {isCancellation && (
            <ToggleGroupItem value="pause" data-testid="transport-request-cadence-pause">Pause regular</ToggleGroupItem>
          )}
          <ToggleGroupItem value="regular" data-testid="transport-request-cadence-regular">
            {isCancellation ? "Cancel regular" : "Regular"}
          </ToggleGroupItem>
        </ToggleGroup>}
        {isCancellation && (
          <p className="text-xs text-muted-foreground">
            {isPause
              ? "Takes their regular off the days you pick until a date, then it runs again by itself. The regular is not changed."
              : isRegular
                ? "Ends their regular on the days you pick after a last day. It will not run on those days again until a new regular is added."
                : "Calls off the transport on those dates only — a one-off, or that day's regular trip. Their regular schedule is not changed."}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Customer</Label>
        {ownerId ? (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="min-w-0">
              <p className="font-medium capitalize truncate">{ownerLabel || "Customer"}</p>
              <p className="text-xs text-muted-foreground">
                {pets.length} dog{pets.length === 1 ? "" : "s"} on file
              </p>
              {owner?.id === ownerId && (
                <div className="mt-1 space-y-0.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <PinBadge lat={homeLat} lng={homeLng} />
                    {(owner.pin_source === "voltlines" || (owner.pin_lat == null && voltlinesHome)) && (
                      <span className="text-muted-foreground">From Voltlines{voltlinesHome?.petName ? ` · ${voltlinesHome.petName}` : ""}</span>
                    )}
                    {homeAddress && <span className="text-muted-foreground">{homeAddress}</span>}
                  </div>
                  {owner.transport_notes?.trim() && (
                    <p>
                      <span className="font-medium">Household: </span>
                      {owner.transport_notes.trim()}
                    </p>
                  )}
                </div>
              )}
            </div>
            {!fixedOwner && (
              <Button variant="ghost" size="sm" onClick={() => pickOwner(null, "")}>
                Change
              </Button>
            )}
          </div>
        ) : creatingOwner ? (
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="First name" value={newOwnerFirst} onChange={(e) => setNewOwnerFirst(e.target.value)} />
              <Input placeholder="Last name" value={newOwnerLast} onChange={(e) => setNewOwnerLast(e.target.value)} />
            </div>
            <Input placeholder="Phone" value={newOwnerPhone} onChange={(e) => setNewOwnerPhone(e.target.value)} />
            <Input placeholder="Dog name" value={newPetName} onChange={(e) => setNewPetName(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveNewOwner} disabled={createOwner.isPending || createPet.isPending}>
                {(createOwner.isPending || createPet.isPending) && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Create and select
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreatingOwner(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Owner name or phone…"
                data-testid="transport-request-owner-search"
                value={ownerSearch}
                onChange={(e) => setOwnerSearch(e.target.value)}
              />
            </div>
            {ownerSearch.trim().length >= 1 && (
              <div className="max-h-40 overflow-auto rounded-md border divide-y">
                {(owners.data ?? []).slice(0, 25).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => pickOwner(o.id, `${o.first_name} ${o.last_name ?? ""}`.trim())}
                    className="w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted"
                  >
                    <span className="font-medium capitalize">
                      {o.first_name} {o.last_name}
                    </span>
                    {o.phone && <span className="text-muted-foreground text-sm"> · {o.phone}</span>}
                  </button>
                ))}
                {ownerSearch.trim().length >= 2 && !owners.isFetching && (owners.data ?? []).length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Nobody matches.</p>
                )}
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCreatingOwner(true)}>
              <UserPlus className="mr-2 h-3.5 w-3.5" />
              New customer
            </Button>
          </>
        )}
      </div>

      {ownerId && (
        <div className="space-y-2">
          <Label>Dogs</Label>
          {petsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active dogs on this customer.</p>
          ) : (
            <div className="space-y-1.5 rounded-md border p-2">
              {pets.map((pet) => (
                <label key={pet.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selectedPetIds.includes(pet.id)}
                    onCheckedChange={(checked) =>
                      setSelectedPetIds((cur) => (checked ? [...cur, pet.id] : cur.filter((id) => id !== pet.id)))
                    }
                  />
                  <span className="capitalize truncate">{pet.name}</span>
                  <VaccineStatusBadge petId={pet.id} />
                  {/* AE shows every dog's Voltlines state here, not just the one that is selected:
                      a request for a dog the vans cannot see is the thing staff must notice first. */}
                  {pet.voltlines_passenger_id ? (
                    <Badge variant="outline" className={`text-[10px] ${TONE.good.badge}`}>On Voltlines</Badge>
                  ) : (
                    <Badge variant="outline" className={`text-[10px] ${TONE.warn.badge}`}>Not on Voltlines</Badge>
                  )}
                  <span className="flex-1" />
                  {pet.driver_note?.trim() && (
                    <span className="text-xs text-muted-foreground truncate max-w-[50%]">{pet.driver_note.trim()}</span>
                  )}
                </label>
              ))}
            </div>
          )}
          {missingVoltlines.length > 0 && (
            <div className={`rounded-md border p-3 text-sm ${TONE.warn.bg} ${TONE.warn.border}`}>
              <p className={`font-medium ${TONE.warn.text}`}>
                {missingVoltlines.length === 1
                  ? `${missingVoltlines[0].name} is`
                  : `${missingVoltlines.map((p) => p.name).join(" and ")} are`}{" "}
                not on Voltlines
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The request still saves. Link each one below so the vans can take it.
              </p>
            </div>
          )}
          {/* One panel per dog that still needs linking — a second dog used to hide the control. */}
          {missingVoltlines.map((pet) => (
            <VoltlinesPetLink key={pet.id} petId={pet.id} petName={pet.name} passengerId={null} />
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Direction</Label>
          <ToggleGroup
            type="multiple"
            value={directions}
            onValueChange={(value) => setDirections(value as Direction[])}
            variant="outline"
            size="sm"
            className="justify-start"
          >
            {DIRECTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value} data-testid={`transport-request-dir-${o.value}`}>
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">Pick both if they need collecting and bringing home.</p>
        </div>

        {isWeekly ? (
          <div className="space-y-2">
            <Label>Which days</Label>
            <ToggleGroup
              type="multiple"
              value={weekdays}
              onValueChange={(value) => setWeekdays(value as string[])}
              variant="outline"
              size="sm"
              className="justify-start flex-wrap"
            >
              {SHORT_DAYS.map((day, i) => (
                <ToggleGroupItem key={day} value={String(i)} aria-label={day} data-testid={`transport-request-day-${i}`}>
                  {day}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              {isPause
                ? weekdays.length
                  ? pauseUntil && pauseUntil >= pauseFrom
                    ? `${directions.length > 1 ? "Pickup and drop-off" : "Their regular"} every ${dayNames} is paused ${shortDate(pauseFrom)} – ${shortDate(pauseUntil)}, and runs again by itself after that.`
                    : "Pick the last paused day below."
                  : "Pick the days their regular is paused on."
                : isCancellation
                  ? weekdays.length
                    ? `Their regular ${directions.length > 1 ? "pickup and drop-off" : "journey"} every ${dayNames} runs for the last time on ${shortDate(endDate || today)}, then stops.`
                    : "Pick the days their regular should stop running on."
                  : weekdays.length
                    ? `Runs every ${dayNames} from ${shortDate(startDate || today)} until it is cancelled. ${directions.length > 1 ? "Both journeys" : "This journey"} on each day.`
                    : "A regular runs on the same days each week — pick as many as apply."}
            </p>
            {isPause ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="request-pause-from" className="text-xs">Paused from</Label>
                  <Input id="request-pause-from" type="date" min={today} value={pauseFrom} onChange={(e) => setPauseFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="request-pause-until" className="text-xs">Paused until (last paused day)</Label>
                  <Input
                    id="request-pause-until"
                    type="date"
                    min={pauseFrom || today}
                    value={pauseUntil}
                    onChange={(e) => setPauseUntil(e.target.value)}
                  />
                </div>
              </div>
            ) : isCancellation ? (
              <div className="space-y-1">
                <Label htmlFor="request-end-date" className="text-xs">Last day it runs</Label>
                <Input id="request-end-date" type="date" min={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="request-start-date" className="text-xs">Starts</Label>
                <Input id="request-start-date" type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            )}
          </div>
        ) : isMove ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="request-move-from">Move from</Label>
              <Input id="request-move-from" data-testid="transport-request-move-from" type="date" min={today} value={moveFrom} onChange={(e) => setMoveFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="request-move-to">To</Label>
              <Input id="request-move-to" data-testid="transport-request-move-to" type="date" min={today} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
            </div>
            {moveFrom && moveTo && moveFrom === moveTo && (
              <p className="col-span-2 text-xs text-amber-700 dark:text-amber-400">Pick a different day — to change only the time, move it to the same day using a new one-off and cancel the old.</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="request-date-0">{serviceDates.length > 1 ? "Dates" : "Date"}</Label>
            {serviceDates.map((date, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  id={`request-date-${index}`}
                  data-testid={`transport-request-date-${index}`}
                  type="date"
                  // A day that has passed cannot be called off; today still can.
                  min={isCancellation ? today : undefined}
                  value={date}
                  onChange={(e) => setServiceDates((cur) => cur.map((v, i) => (i === index ? e.target.value : v)))}
                />
                {serviceDates.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove this date"
                    onClick={() => setServiceDates((cur) => cur.filter((_, i) => i !== index))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setServiceDates((cur) => {
                  const last = cur.filter(Boolean).sort().at(-1) ?? today;
                  return [...cur, nextDay(last)];
                })
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add another day
            </Button>
            {datesChosen.length > 1 && (
              <p className="text-xs text-muted-foreground">{datesChosen.length} days, recorded together as one request.</p>
            )}
          </div>
        )}

        {!isCancellation &&
          DIRECTIONS.filter((o) => directions.includes(o.value)).map((o) => (
            <div key={o.value} className="space-y-2">
              <Label>{directions.length > 1 ? `${o.label} time` : "Time"}</Label>
              <Select
                value={slotByDirection[o.value] ?? ""}
                onValueChange={(value) => {
                  setSlotByDirection((prev) => ({ ...prev, [o.value]: value }));
                  // A time typed over an accepted offer is no longer that promise.
                  setAcceptedByDirection((prev) => ({ ...prev, [o.value]: undefined }));
                }}
              >
                <SelectTrigger data-testid={`transport-request-slot-${o.value}`}>
                  <SelectValue placeholder="No time yet" />
                </SelectTrigger>
                <SelectContent>
                  {slotsFor(o.value).map((slot) => (
                    <SelectItem key={slot.id} value={slot.id}>
                      {slot.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Leave blank if they have not said. It saves without one.</p>
              {!isMove && !isWeekly && !locationByDirection[o.value].enabled && (
                <HubOfferTimes
                  petId={selectedPetIds.length === 1 ? selectedPetIds[0] : null}
                  date={datesChosen.length === 1 ? datesChosen[0] : null}
                  direction={o.value}
                  askedStartMin={slotsFor(o.value).find((s) => s.id === slotByDirection[o.value])?.start_min ?? null}
                  accepted={acceptedByDirection[o.value] ?? null}
                  onAccept={(offer) => {
                    setAcceptedByDirection((prev) => ({ ...prev, [o.value]: offer ?? undefined }));
                    const slot = offer ? slotsFor(o.value).find((s) => s.start_min === offer.startMin) : null;
                    if (slot) setSlotByDirection((prev) => ({ ...prev, [o.value]: slot.id }));
                  }}
                />
              )}
              {allowsLocation && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={locationByDirection[o.value].enabled}
                      onCheckedChange={(checked) =>
                        setLocationByDirection((prev) => ({ ...prev, [o.value]: { ...prev[o.value], enabled: checked === true } }))
                      }
                    />
                    Different {o.value === "pickup" ? "pickup" : "drop-off"} address (hotel, friend's house…)
                  </label>
                  {locationByDirection[o.value].enabled && (
                    <div className="space-y-2 pl-6">
                      <Input
                        placeholder="Where — shown on the board"
                        value={locationByDirection[o.value].text}
                        onChange={(e) =>
                          setLocationByDirection((prev) => ({ ...prev, [o.value]: { ...prev[o.value], text: e.target.value } }))
                        }
                      />
                      <PinField
                        value={locationByDirection[o.value].pin}
                        onChange={(pin) => setLocationByDirection((prev) => ({ ...prev, [o.value]: { ...prev[o.value], pin } }))}
                        hint="Optional: a dropped pin for this address."
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

        <div className="space-y-2">
          <Label>Branch</Label>
          <ToggleGroup
            type="single"
            value={branchId ?? ""}
            onValueChange={(value) => value && setBranchId(value)}
            variant="outline"
            size="sm"
            className="justify-start"
          >
            {dipFirst(branches).map((b) => (
              <ToggleGroupItem key={b.id} value={b.id} disabled={branchLocked && b.id !== activeBranchId}>
                {b.short_name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {branchLocked && (
            <p className="text-xs text-muted-foreground">You can add requests for {branchShort} only.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="request-notes">Notes</Label>
        <Textarea
          id="request-notes"
          rows={2}
          value={notes}
          placeholder="Anything the driver or reception needs to know"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm space-y-1.5" data-testid="transport-request-same-day">
          <p className="font-medium text-amber-700 dark:text-amber-400">Already on the vans</p>
          <ul className="text-xs list-disc pl-4 space-y-0.5">
            {conflicts.map((c) => (
              <li key={`${c.date}|${c.petId}|${c.direction}`}>
                {c.petName} already has a {c.direction === "pickup" ? "pickup" : "drop-off"} on {dayDate(c.date)}
                {c.time ? ` at ${c.time}` : ""} ({c.source})
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox checked={acceptConflicts} onCheckedChange={(v) => setAcceptConflicts(v === true)} data-testid="transport-request-same-day-ok" />
            Book it anyway (e.g. a second trip that day)
          </label>
        </div>
      )}

      {clashes.length > 0 && (
        <div
          className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm"
          data-testid="transport-request-boarding-clash"
        >
          <p className="font-medium text-amber-700 dark:text-amber-400">Boarding — this trip will not run</p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {clashes.map((c) => (
              <li key={`${c.petId}-${c.date}-${c.direction}`}>
                <span className="capitalize">{petName(c.petId)}</span> is boarding on {shortDate(c.date)}
                {c.reason === "boarding_check_out"
                  ? " and checks out that day. A pickup is paused — the dog is already here. To take it home, choose Dropoff."
                  : c.reason === "boarding_check_in"
                    ? " and checks in that day, so the drop-off home is paused."
                    : `, so no ${c.direction === "pickup" ? "pickup" : "drop-off"} runs that day.`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button className="w-full" disabled={!canSave} onClick={save} data-testid="transport-request-save">
        {record.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
        {isMove ? "Record move" : isCancellation ? (isPause ? "Pause regular" : isRegular ? "End regular" : "Record cancellation") : "Record request"}
      </Button>
    </div>
  );
}
