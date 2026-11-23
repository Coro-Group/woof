import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { useTransportHubQuote, useTransportHubStatus, type HubQuote } from "@/hooks/useTransport";
import { OfferList, OutcomeBadge, PromiseBox, VOLTLINES_QUOTE_NOTE, quoteToPanelOffers } from "@/components/transport/OfferPanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** One vet trip to price: to the clinic (arrive by), back from it (after ready), or home. */
export type VetLegPlan = {
  role: "outbound" | "return" | "home";
  direction: "pickup" | "dropoff";
  date: string;
  /** The minute that matters: the arrive-by deadline, the ready time, or the home window start. */
  targetMin: number;
  vet: { deadlineMin?: number; readyMin?: number; windowStartMin?: number; windowEndMin?: number };
  /** Where the van goes: the clinic, or null for the home pin. */
  location: { label: string; lat: number; lng: number } | null;
  label: string;
};

/** What staff chose for a leg: a van time, or booking it without one for dispatch to arrange. */
export type VetLegChoice =
  | { kind: "offer"; startMin: number; slotLabel: string; eta: string | null }
  | { kind: "none"; reason: string };

const hourOf = (min: number) => Math.min(20 * 60, Math.max(6 * 60, Math.floor(min / 60) * 60));

/**
 * Van times for a vet visit (Chris, 23 Nov 2026): every vet trip is checked against the
 * vans before it is booked, like any other request. AE's quote keeps only times that
 * reach the clinic by the arrive-by deadline, or collect after the pet is ready; the
 * drop-off home is priced like any one-off. Staff pick one per trip. When no van can
 * make it, the trip can still be booked — a vet appointment can't be refused — and it
 * is flagged for dispatch to arrange.
 */
export function VetLegTimes({
  petId,
  legs,
  planKey,
  onChange,
}: {
  petId: string | null;
  legs: VetLegPlan[];
  /** Changes whenever the visit changes, so old times are not kept against a new plan. */
  planKey: string;
  onChange: (choices: Partial<Record<VetLegPlan["role"], VetLegChoice>>, ready: boolean) => void;
}) {
  const status = useTransportHubStatus();
  const quote = useTransportHubQuote();
  const [quotes, setQuotes] = useState<Partial<Record<VetLegPlan["role"], { quote: HubQuote | null; error: string | null }>>>({});
  const [choices, setChoices] = useState<Partial<Record<VetLegPlan["role"], VetLegChoice>>>({});
  const [checking, setChecking] = useState(false);
  const on = !!status.data?.enabled && !!status.data?.configured && status.data?.hub?.enabled === true;

  useEffect(() => {
    setQuotes({});
    setChoices({});
  }, [planKey]);
  useEffect(() => {
    onChange(choices, legs.length > 0 && legs.every((l) => !!choices[l.role]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, legs.length]);

  if (!on || !legs.length) return null;

  const check = async () => {
    if (!petId) return;
    setChecking(true);
    setChoices({});
    const next: typeof quotes = {};
    for (const leg of legs) {
      try {
        const q = await quote.mutateAsync({
          petId,
          date: leg.date,
          direction: leg.direction,
          startMin: hourOf(leg.targetMin),
          vet: leg.vet,
          ...(leg.location ? { location: leg.location } : {}),
        });
        next[leg.role] = { quote: q, error: null };
      } catch (err) {
        next[leg.role] = { quote: null, error: (err as Error).message };
      }
      setQuotes({ ...next });
    }
    setChecking(false);
  };

  const choose = (role: VetLegPlan["role"], choice: VetLegChoice | undefined) =>
    setChoices((prev) => {
      const out = { ...prev };
      if (choice) out[role] = choice;
      else delete out[role];
      return out;
    });

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3" data-testid="transport-vet-times">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={check} disabled={!petId || checking}>
          {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Truck className="mr-1.5 h-3.5 w-3.5" />}
          {Object.keys(quotes).length ? "Check van times again" : "Check van times"}
        </Button>
        {!petId && <span className="text-xs text-muted-foreground">Pick the pet first.</span>}
      </div>
      {legs.map((leg) => {
        const got = quotes[leg.role];
        const chosen = choices[leg.role];
        const panel = got?.quote ? quoteToPanelOffers(got.quote.offers) : [];
        return (
          <div key={leg.role} className="space-y-1.5">
            <p className="text-xs font-medium">{leg.label}</p>
            {chosen?.kind === "offer" ? (
              <div className="space-y-1">
                <PromiseBox slotLabel={chosen.slotLabel} eta={chosen.eta} />
                <button type="button" className="text-xs underline text-muted-foreground" onClick={() => choose(leg.role, undefined)}>
                  Choose again
                </button>
              </div>
            ) : got?.error ? (
              <p className="text-xs text-destructive">{got.error}</p>
            ) : got?.quote ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <OutcomeBadge outcome={got.quote.outcome} />
                </div>
                {got.quote.reason && (
                  <p className="text-sm rounded-md border-l-2 border-amber-500 bg-muted/50 px-3 py-2">{got.quote.reason}</p>
                )}
                <OfferList
                  offers={panel}
                  onAccept={(offerId) => {
                    const i = Number(offerId);
                    const o = got.quote?.offers[i];
                    const p = panel[i];
                    if (!o || !p || o.startMin == null) return;
                    choose(leg.role, { kind: "offer", startMin: o.startMin, slotLabel: p.slotLabel, eta: o.eta });
                  }}
                  emptyText="No van can make this time."
                />
                {panel.length === 0 && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={chosen?.kind === "none"}
                      onCheckedChange={(v) =>
                        choose(leg.role, v ? { kind: "none", reason: got.quote?.reason ?? "no van could make the vet time" } : undefined)
                      }
                    />
                    Book it anyway — dispatch arranges the van
                  </label>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {Object.keys(quotes).length > 0 && <p className="text-xs text-muted-foreground">{VOLTLINES_QUOTE_NOTE}</p>}
    </div>
  );
}

/** The trips of a visit that can be priced now, from its legs (transportVetVisit legsForVisit). */
export function vetLegPlans(
  legs: Array<{
    role: string;
    direction: string;
    service_date: string;
    atClinic: boolean;
    deadline_min: number | null;
    window_start_min: number;
    window_end_min: number;
  }>,
  clinic: { label: string; lat: number; lng: number } | null,
  clock: (min: number) => string,
): VetLegPlan[] {
  const out: VetLegPlan[] = [];
  for (const l of legs) {
    const role = l.role as VetLegPlan["role"];
    const direction = l.direction as VetLegPlan["direction"];
    if (l.atClinic && !clinic) continue;
    if (role === "outbound" && l.deadline_min != null) {
      out.push({ role, direction, date: l.service_date, targetMin: l.deadline_min, vet: { deadlineMin: l.deadline_min }, location: clinic, label: `To the clinic · arrive by ${clock(l.deadline_min)}` });
    } else if (role === "return") {
      // The way back starts when the pet is ready: the window's start.
      out.push({ role, direction, date: l.service_date, targetMin: l.window_start_min, vet: { readyMin: l.window_start_min }, location: clinic, label: `Back from the clinic · ready ${clock(l.window_start_min)}` });
    } else if (role === "home") {
      out.push({
        role,
        direction,
        date: l.service_date,
        targetMin: l.window_start_min,
        vet: { windowStartMin: l.window_start_min, windowEndMin: l.window_end_min },
        location: null,
        label: `Home · ${clock(l.window_start_min)}–${clock(l.window_end_min)}`,
      });
    }
  }
  return out;
}
