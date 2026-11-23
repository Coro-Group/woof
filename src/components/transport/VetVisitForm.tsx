import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useOwner, useOwners } from "@/hooks/useOwners";
import { usePets } from "@/hooks/usePets";
import { useCurrentStaffName, useTransportHubStatus } from "@/hooks/useTransport";
import { useSaveVetClinic, useTransportVetClinics, useWriteVetVisit } from "@/hooks/useTransportVet";
import { isPetDeceased } from "@/lib/petDeceased";
import { dubaiToday } from "@/lib/transportSchedule";
import {
  RETURN_TO_LABEL,
  VISIT_MODE_LABEL,
  clock12,
  clockOf,
  legsForVisit,
  normaliseVisit,
  pendingLabel,
  timeToMinutes,
  type ReturnTo,
  type VisitMode,
} from "@/lib/transportVetVisit";
import { PinField, emptyPin, pinReady, type PinDraft } from "@/components/transport/PinField";
import { PinBadge, dipFirst } from "@/components/transport/transportShared";
import { TransportProfileStep } from "@/components/transport/TransportProfileStep";
import { VetLegTimes, vetLegPlans, type VetLegChoice } from "@/components/transport/VetLegTimes";
import { VaccineStatusBadge } from "@/components/VaccineStatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const NEW_CLINIC = "__new__";

/**
 * Book a pet from the branch to a vet appointment and (usually) back — AE's
 * VetVisitForm. The legs are worked out from the appointment, the arrive-early buffer
 * and how long the pet stays; anything not known yet (the vet's call) is set from the
 * Desk later. Every trip that can be priced now is checked against the vans first (Van
 * times), and the pets need a transport profile for that (23 Nov 2026).
 */
export function VetVisitForm({ onSaved }: { onSaved?: () => void }) {
  const today = dubaiToday();
  const { branchId: activeBranchId, branches, branchLocked } = useBranch();
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerLabel, setOwnerLabel] = useState("");
  const [selectedPetIds, setSelectedPetIds] = useState<string[]>([]);
  const [branchId, setBranchId] = useState<string | null>(activeBranchId);
  const [clinicId, setClinicId] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [clinicPin, setClinicPin] = useState<PinDraft>(emptyPin());
  const [saveClinic, setSaveClinic] = useState(true);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [buffer, setBuffer] = useState("15");
  const [mode, setMode] = useState<VisitMode>("wait");
  const [duration, setDuration] = useState("30");
  const [readyTime, setReadyTime] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [returnTo, setReturnTo] = useState<ReturnTo>("facility");
  const [homeStart, setHomeStart] = useState("");
  const [homeEnd, setHomeEnd] = useState("");
  const [notes, setNotes] = useState("");

  const owners = useOwners(ownerSearch.trim().length >= 2 ? ownerSearch : undefined);
  const { data: owner } = useOwner(ownerId ?? "");
  const { data: petsRaw = [], isLoading: petsLoading } = usePets(ownerId ?? "");
  const pets = petsRaw.filter((p) => !isPetDeceased(p));
  const { data: clinics = [] } = useTransportVetClinics();
  const { data: staffName } = useCurrentStaffName();
  const write = useWriteVetVisit();
  const saveClinicMutation = useSaveVetClinic();

  useEffect(() => {
    if (branchLocked || !branchId) setBranchId(activeBranchId);
  }, [activeBranchId, branchLocked]);
  useEffect(() => {
    if (pets.length === 1) setSelectedPetIds([pets[0].id]);
  }, [ownerId, pets.length]);
  // An owner collecting from the clinic means the driver is not waiting there.
  useEffect(() => {
    if (mode === "wait" && returnTo === "owner_collects") setReturnTo("facility");
  }, [mode, returnTo]);

  const minutes = (value: string) => (value.trim() ? timeToMinutes(value) : null);
  const draft = useMemo(() => {
    try {
      const visit = normaliseVisit({
        appointmentDate: date,
        appointmentTimeMin: minutes(time),
        arriveBufferMin: buffer === "" ? 15 : Number(buffer),
        visitMode: mode,
        expectedDurationMin: mode === "wait" ? (duration === "" ? null : Number(duration)) : null,
        returnTo,
        returnDate: mode === "admitted" ? returnDate || null : null,
        readyTimeMin: mode === "wait" ? null : minutes(readyTime),
        homeWindowStartMin: returnTo === "home" ? minutes(homeStart) : null,
        homeWindowEndMin: returnTo === "home" ? minutes(homeEnd) : null,
      });
      return { input: visit, plan: legsForVisit(visit), error: null as string | null };
    } catch (error) {
      return { input: null, plan: null, error: error instanceof Error ? error.message : "Check the times" };
    }
  }, [date, time, buffer, mode, duration, readyTime, returnDate, returnTo, homeStart, homeEnd]);

  const newClinic = clinicId === NEW_CLINIC;
  const chosen = clinics.find((c) => c.id === clinicId) ?? null;
  // A saved clinic with no pin yet needs one the first time a van goes there.
  const needsPin = newClinic || (!!chosen && (chosen.lat == null || chosen.lng == null));
  const clinicReady = newClinic ? !!clinicName.trim() && pinReady(clinicPin) : !!chosen && (!needsPin || pinReady(clinicPin));
  const homeNeedsPin = returnTo === "home" && owner?.id === ownerId && owner?.pin_lat == null;
  // Van times (23 Nov 2026): the trips priced before booking, and what was chosen for each.
  const hub = useTransportHubStatus();
  const hubOn = !!hub.data?.enabled && !!hub.data?.configured && hub.data?.hub?.enabled === true;
  const clinicPlace = newClinic || needsPin
    ? (pinReady(clinicPin) ? { label: newClinic ? clinicName.trim() || "Vet clinic" : chosen?.name ?? "Vet clinic", lat: clinicPin.pin!.lat, lng: clinicPin.pin!.lng } : null)
    : chosen && chosen.lat != null && chosen.lng != null ? { label: chosen.name, lat: chosen.lat, lng: chosen.lng } : null;
  const vetPlans = draft.plan ? vetLegPlans(draft.plan.legs, clinicPlace, clockOf) : [];
  const vetPlanKey = JSON.stringify([selectedPetIds, vetPlans, branchId]);
  const [vetChoices, setVetChoices] = useState<Partial<Record<string, VetLegChoice>>>({});
  const [vetReady, setVetReady] = useState(false);
  const selectedPets = pets.filter((p) => selectedPetIds.includes(p.id));
  const missingProfile = selectedPets.filter((p) => !p.voltlines_passenger_id);
  const timesNeeded = hubOn && vetPlans.length > 0;
  const canSave =
    !!ownerId && !!branchId && selectedPetIds.length > 0 && clinicReady && !!draft.input && !write.isPending &&
    (!timesNeeded || (missingProfile.length === 0 && vetReady));

  const reset = () => {
    setOwnerSearch("");
    setOwnerId(null);
    setOwnerLabel("");
    setSelectedPetIds([]);
    setClinicId("");
    setClinicName("");
    setClinicPin(emptyPin());
    setTime("");
    setMode("wait");
    setDuration("30");
    setReadyTime("");
    setReturnDate("");
    setReturnTo("facility");
    setHomeStart("");
    setHomeEnd("");
    setNotes("");
  };

  const save = async () => {
    if (!canSave || !draft.input) return;
    try {
      let clinic: { id: string | null; label: string; lat: number; lng: number };
      if (newClinic || needsPin) {
        const label = newClinic ? clinicName.trim() : chosen!.name;
        const pin = clinicPin.pin!;
        const id = newClinic && !saveClinic ? null : await saveClinicMutation.mutateAsync({ name: label, address_label: pin.area, lat: pin.lat, lng: pin.lng, maps_link: clinicPin.text });
        clinic = { id, label, lat: pin.lat, lng: pin.lng };
      } else {
        clinic = { id: chosen!.id, label: chosen!.name, lat: chosen!.lat!, lng: chosen!.lng! };
      }
      const result = await write.mutateAsync({
        branchId: branchId!,
        ownerId: ownerId!,
        petIds: selectedPetIds,
        clinic,
        home: { lat: owner?.pin_lat ?? null, lng: owner?.pin_lng ?? null, label: owner?.address ?? null },
        notes: notes.trim() || null,
        input: draft.input,
        actor: staffName ?? "Staff",
        ...(timesNeeded ? { promises: vetChoices } : {}),
      });
      toast.success(
        result.pending ? `Vet visit booked — ${pendingLabel(result.pending)?.toLowerCase()}; set it from the Desk` : "Vet visit booked",
      );
      reset();
      onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't book the vet visit");
    }
  };

  return (
    <div className="space-y-5" data-testid="transport-vet-form">
      <div className="space-y-2">
        <Label>Pet</Label>
        {ownerId ? (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="min-w-0">
              <p className="font-medium capitalize truncate">{ownerLabel || "Customer"}</p>
              {owner?.id === ownerId && <PinBadge lat={owner.pin_lat} lng={owner.pin_lng} />}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setOwnerId(null); setSelectedPetIds([]); }}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Owner name or phone…"
                data-testid="transport-vet-owner-search"
                value={ownerSearch}
                onChange={(e) => setOwnerSearch(e.target.value)}
              />
            </div>
            {ownerSearch.trim().length >= 2 && (
              <div className="max-h-40 overflow-auto rounded-md border divide-y">
                {(owners.data ?? []).slice(0, 25).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setOwnerId(o.id);
                      setOwnerLabel(`${o.first_name} ${o.last_name ?? ""}`.trim());
                      setSelectedPetIds([]);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted"
                  >
                    <span className="font-medium capitalize">{o.first_name} {o.last_name}</span>
                    {o.phone && <span className="text-muted-foreground text-sm"> · {o.phone}</span>}
                  </button>
                ))}
                {!owners.isFetching && (owners.data ?? []).length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Nobody matches.</p>
                )}
              </div>
            )}
          </>
        )}
        {ownerId &&
          (petsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : pets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active pets on this customer.</p>
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
                  <span className="flex-1" />
                </label>
              ))}
            </div>
          ))}
      </div>

      <div className="space-y-2">
        <Label>Leaves from</Label>
        <ToggleGroup type="single" value={branchId ?? ""} onValueChange={(v) => v && setBranchId(v)} variant="outline" size="sm" className="justify-start">
          {dipFirst(branches).map((b) => (
            <ToggleGroupItem key={b.id} value={b.id} disabled={branchLocked && b.id !== activeBranchId}>
              {b.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="space-y-2">
        <Label>Vet clinic</Label>
        <Select value={clinicId} onValueChange={(v) => { setClinicId(v); setClinicPin(emptyPin()); }}>
          <SelectTrigger data-testid="transport-vet-clinic">
            <SelectValue placeholder="Choose a clinic" />
          </SelectTrigger>
          <SelectContent>
            {clinics.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.address_label && c.address_label !== c.name ? ` — ${c.address_label}` : ""}
                {c.lat == null ? " (no pin yet)" : ""}
              </SelectItem>
            ))}
            <SelectItem value={NEW_CLINIC}>+ A clinic not on the list</SelectItem>
          </SelectContent>
        </Select>
        {needsPin && (
          <div className="space-y-2 rounded-md border p-2">
            {newClinic && (
              <Input
                placeholder="Clinic name (required), e.g. Blue Oasis Vet, Jumeirah"
                data-testid="transport-vet-clinic-name"
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
              />
            )}
            <PinField
              value={clinicPin}
              onChange={setClinicPin}
              placeholder="Google Maps link or lat, lng (required)"
              hint={newClinic ? "Drop a pin on the clinic in Google Maps and share it." : "This clinic has no pin yet — add it once and it's saved."}
            />
            {newClinic && (
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={saveClinic} onCheckedChange={(c) => setSaveClinic(c === true)} />
                Save this clinic for next time
              </label>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="vet-date">Appointment date</Label>
          <Input id="vet-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vet-time">Appointment time</Label>
          <Input id="vet-time" data-testid="transport-vet-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vet-buffer">Arrive early (min)</Label>
          <Input id="vet-buffer" type="number" min={0} max={180} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>How long</Label>
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as VisitMode)} variant="outline" size="sm" className="justify-start flex-wrap">
          <ToggleGroupItem value="wait">{VISIT_MODE_LABEL.wait}</ToggleGroupItem>
          <ToggleGroupItem value="return_later">{VISIT_MODE_LABEL.return_later}</ToggleGroupItem>
          <ToggleGroupItem value="admitted">{VISIT_MODE_LABEL.admitted}</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {mode === "wait"
            ? "A quick vaccination or procedure: the same driver waits and brings the pet back."
            : mode === "return_later"
              ? "Hours: the driver leaves, and a van comes back when the vet says the pet is ready."
              : "Overnight or longer: the pet comes back on a later day."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "wait" && (
            <div className="space-y-1">
              <Label htmlFor="vet-duration" className="text-xs">Visit length (min)</Label>
              <Input id="vet-duration" type="number" min={0} max={240} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </div>
          )}
          {mode === "admitted" && (
            <div className="space-y-1">
              <Label htmlFor="vet-return-date" className="text-xs">Discharge date (if known)</Label>
              <Input id="vet-return-date" type="date" min={date} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
          )}
          {mode !== "wait" && returnTo !== "owner_collects" && (
            <div className="space-y-1">
              <Label htmlFor="vet-ready" className="text-xs">Ready to collect at (if known)</Label>
              <Input id="vet-ready" type="time" value={readyTime} onChange={(e) => setReadyTime(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Afterwards</Label>
        <ToggleGroup type="single" value={returnTo} onValueChange={(v) => v && setReturnTo(v as ReturnTo)} variant="outline" size="sm" className="justify-start flex-wrap">
          <ToggleGroupItem value="facility">{RETURN_TO_LABEL.facility}</ToggleGroupItem>
          <ToggleGroupItem value="home">{RETURN_TO_LABEL.home}</ToggleGroupItem>
          <ToggleGroupItem value="owner_collects" disabled={mode === "wait"}>{RETURN_TO_LABEL.owner_collects}</ToggleGroupItem>
        </ToggleGroup>
        {returnTo === "home" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="vet-home-start" className="text-xs">Drop-off home from</Label>
              <Input id="vet-home-start" type="time" value={homeStart} onChange={(e) => setHomeStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vet-home-end" className="text-xs">until (one hour at most)</Label>
              <Input id="vet-home-end" type="time" value={homeEnd} onChange={(e) => setHomeEnd(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              The van brings the pet back to the branch first, then it goes home on a drop-off in this window.
              {homeNeedsPin && <span className="text-red-700 dark:text-red-400"> This household has no home pin yet.</span>}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="vet-notes">Notes</Label>
        <Textarea id="vet-notes" rows={2} value={notes} placeholder="What the vet is for, who to ask for at reception" onChange={(e) => setNotes(e.target.value)} />
      </div>

      <VetVisitPreview error={time ? draft.error : null} plan={draft.plan} />

      {timesNeeded && ownerId && missingProfile.length > 0 && (
        <TransportProfileStep
          ownerId={ownerId}
          ownerName={ownerLabel || "the client"}
          address={owner?.id === ownerId ? owner.address ?? null : null}
          pinLat={owner?.id === ownerId ? owner.pin_lat ?? null : null}
          pinLng={owner?.id === ownerId ? owner.pin_lng ?? null : null}
          pets={selectedPets.map((p) => ({ id: p.id, name: p.name, voltlines_passenger_id: p.voltlines_passenger_id ?? null }))}
        />
      )}
      {timesNeeded && missingProfile.length === 0 && (
        <VetLegTimes
          petId={selectedPetIds[0] ?? null}
          legs={vetPlans}
          planKey={vetPlanKey}
          onChange={(choices, ready) => {
            setVetChoices(choices);
            setVetReady(ready);
          }}
        />
      )}
      {timesNeeded && missingProfile.length === 0 && !vetReady && (
        <p className="text-xs text-muted-foreground">Check van times and choose one for each trip before booking.</p>
      )}

      <Button className="w-full" disabled={!canSave} onClick={save} data-testid="transport-vet-save">
        {write.isPending || saveClinicMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Stethoscope className="mr-2 h-4 w-4" />
        )}
        Book vet visit
      </Button>
    </div>
  );
}

/** The legs about to be booked, in plain words, before anyone presses the button. */
export function VetVisitPreview({ error, plan }: { error: string | null; plan: ReturnType<typeof legsForVisit> | null }) {
  if (error) return <p className="text-xs text-red-700 dark:text-red-400" data-testid="transport-vet-error">{error}</p>;
  if (!plan) return null;
  const line = (leg: (typeof plan.legs)[number]) => {
    if (leg.role === "outbound") return `To the vet — arrive by ${clock12(leg.deadline_min)}`;
    if (leg.role === "return") return `Back to the branch — collect from ${clock12(leg.window_start_min)}${leg.service_date ? ` on ${leg.service_date}` : ""}`;
    return `Home — ${clockOf(leg.window_start_min)}–${clockOf(leg.window_end_min)}`;
  };
  return (
    <div className="rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 p-3 text-sm space-y-1" data-testid="transport-vet-preview">
      <p className="font-medium text-sky-700 dark:text-sky-400">This books</p>
      <ul className="text-xs space-y-0.5 list-disc pl-4">
        {plan.legs.map((leg) => <li key={leg.role}>{line(leg)}</li>)}
        {plan.pending && <li className="text-amber-700 dark:text-amber-400">{pendingLabel(plan.pending)} — set it from the Desk later</li>}
      </ul>
    </div>
  );
}
