import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCreateVoltlinesPassenger } from "@/hooks/useVoltlines";
import { PinField, emptyPin, pinReady, type PinDraft } from "@/components/transport/PinField";
import { VoltlinesPetLink } from "@/components/transport/VoltlinesPetLink";
import { TONE } from "@/components/transport/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ProfilePet = { id: string; name: string; voltlines_passenger_id: string | null };

/**
 * The transport profile a request needs before it can be offered (Chris, 23 Nov 2026).
 *
 * Every new request is offered times from the vans' own routes, so a dog has to exist
 * there first: a "transport profile" (a Voltlines passenger — reception never sees that
 * word). This step asks for what is missing, in order:
 *   1. the home address and pin, when the client has none (the vans route to the pin);
 *   2. Create transport profile — beside a household dog that already has one (same
 *      door), otherwise as a new household at the pin (api/transport-voltlines op create).
 * Once created, the database sync puts the dog on the dispatch board within seconds and
 * Offer works. There is no booking by hand around it any more.
 */
export function TransportProfileStep({
  ownerId,
  ownerName,
  address,
  pinLat,
  pinLng,
  pets,
}: {
  ownerId: string;
  ownerName: string;
  address: string | null;
  pinLat: number | null;
  pinLng: number | null;
  /** The dogs on this request. */
  pets: ProfilePet[];
}) {
  const qc = useQueryClient();
  const create = useCreateVoltlinesPassenger();
  const missing = pets.filter((p) => !p.voltlines_passenger_id);
  const hasPin = pinLat != null && pinLng != null;
  const [addressText, setAddressText] = useState(address ?? "");
  const [pin, setPin] = useState<PinDraft>(emptyPin());
  const [savingPin, setSavingPin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [findFor, setFindFor] = useState<ProfilePet | null>(null);
  useEffect(() => setAddressText(address ?? ""), [address]);

  if (!missing.length && hasPin) return null;

  const names = (list: ProfilePet[]) => list.map((p) => p.name).join(", ");

  const savePin = async () => {
    if (!pinReady(pin)) return;
    setSavingPin(true);
    try {
      const { error } = await supabase
        .from("owners")
        .update({
          address: addressText.trim() || address || null,
          pin_lat: pin.pin!.lat,
          pin_lng: pin.pin!.lng,
          pin_source: pin.pin!.source,
          pin_updated_at: new Date().toISOString(),
        })
        .eq("id", ownerId);
      if (error) throw error;
      toast.success("Home address and pin saved on the client profile");
      await qc.invalidateQueries({ queryKey: ["transport"] });
      await qc.invalidateQueries({ queryKey: ["owners"] });
      await qc.invalidateQueries({ queryKey: ["owner", ownerId] });
    } catch (err) {
      toast.error((err as Error).message || "Could not save the pin");
    } finally {
      setSavingPin(false);
    }
  };

  // One dog at a time: the first opens the household, the rest join it beside that dog.
  const createProfiles = async () => {
    setCreating(true);
    const done: string[] = [];
    try {
      for (const pet of missing) {
        await create.mutateAsync({ petId: pet.id });
        done.push(pet.name);
      }
      toast.success(
        `Transport profile created for ${done.join(", ")}. It reaches the dispatch board in a few seconds — then press Offer.`,
      );
    } catch (err) {
      const msg = (err as Error).message || "Could not create the transport profile";
      toast.error(done.length ? `Created for ${done.join(", ")}, but not the rest: ${msg}` : msg);
    } finally {
      setCreating(false);
      await qc.invalidateQueries({ queryKey: ["pets"] });
      await qc.invalidateQueries({ queryKey: ["transport"] });
    }
  };

  return (
    <div className={`space-y-3 rounded-md border p-3 ${TONE.warn.border} ${TONE.warn.bg}`} data-testid="transport-profile-step">
      <div className="space-y-1">
        <p className="text-sm font-medium">Transport profile needed</p>
        <p className="text-xs text-muted-foreground">
          {missing.length
            ? `${names(missing)} ${missing.length === 1 ? "has" : "have"} no transport profile yet, so no times can be offered. `
            : "The client has no home pin, so no times can be offered. "}
          {!hasPin ? "Add the home address and pin first." : missing.length ? "Create it, then press Offer." : ""}
        </p>
      </div>

      {!hasPin && (
        <div className="space-y-2" data-testid="transport-profile-pin">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="transport-profile-address">
              Home address
            </Label>
            <Input
              id="transport-profile-address"
              value={addressText}
              onChange={(e) => setAddressText(e.target.value)}
              placeholder="Villa / building, street, community"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Home pin</Label>
            <PinField value={pin} onChange={setPin} />
          </div>
          <Button type="button" size="sm" variant="outline" onClick={savePin} disabled={!pinReady(pin) || savingPin}>
            {savingPin ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MapPin className="mr-1.5 h-3.5 w-3.5" />}
            Save address and pin
          </Button>
        </div>
      )}

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={createProfiles}
            disabled={!hasPin || creating}
            title={!hasPin ? "Add the home address and pin first" : undefined}
            data-testid="transport-profile-create"
          >
            {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserPlus className="mr-1.5 h-3.5 w-3.5" />}
            Create transport profile
          </Button>
          <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setFindFor(missing[0])}>
            Already has one? Find it
          </button>
        </div>
      )}

      {findFor && <VoltlinesPetLink petId={findFor.id} petName={findFor.name} passengerId={null} />}
    </div>
  );
}
