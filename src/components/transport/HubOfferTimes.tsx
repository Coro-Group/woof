import { Loader2, Sparkles } from "lucide-react";
import { useTransportHubQuote, useTransportHubStatus, type HubOffer } from "@/hooks/useTransport";
import { Button } from "@/components/ui/button";

/** Offer times from the vans on Admin Essentials. Hidden while that link is off. */
export function HubOfferTimes({
  petId,
  date,
  direction,
  askedStartMin,
  location,
  onPick,
}: {
  petId: string | null;
  date: string | null;
  direction: "pickup" | "dropoff";
  askedStartMin: number | null;
  location?: { label: string; lat: number; lng: number } | null;
  onPick: (startMin: number) => void;
}) {
  const status = useTransportHubStatus();
  const quote = useTransportHubQuote();
  const on = !!status.data?.enabled && !!status.data?.configured && status.data?.hub?.enabled === true;
  if (!on) return null;

  const missing = !petId ? "one dog" : !date ? "one date" : askedStartMin == null ? "the hour they asked for" : null;
  const ask = () => {
    if (!petId || !date || askedStartMin == null) return;
    quote.mutate({ petId, date, direction, startMin: askedStartMin, ...(location ? { location } : {}) });
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2" data-testid={`transport-hub-offers-${direction}`}>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={ask} disabled={!!missing || quote.isPending}>
          {quote.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Get offer times
        </Button>
        <span className="text-xs text-muted-foreground">
          {missing ? `Choose ${missing} first.` : "From the vans on Admin Essentials (takes a few seconds)."}
        </span>
      </div>
      {quote.error && <p className="text-xs text-destructive">{(quote.error as Error).message}</p>}
      {quote.data && (
        <div className="space-y-1">
          {quote.data.reason && <p className="text-xs text-muted-foreground">{quote.data.reason}</p>}
          {quote.data.offers.length === 0 ? (
            <p className="text-xs">No time offered — the transport team will need to look at this one.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {quote.data.offers.map((o) => (
                <OfferChip key={`${o.slotLabel}-${o.eta}`} offer={o} onPick={onPick} />
              ))}
            </div>
          )}
          {quote.data.estimated && <p className="text-xs text-muted-foreground">Estimated: the route checker is busy, times are approximate.</p>}
        </div>
      )}
    </div>
  );
}

function OfferChip({ offer, onPick }: { offer: HubOffer; onPick: (startMin: number) => void }) {
  const label = offer.promisedSlotLabel ?? offer.slotLabel ?? "?";
  return (
    <Button
      type="button"
      size="sm"
      variant={offer.recommended ? "default" : "outline"}
      disabled={offer.startMin == null}
      onClick={() => offer.startMin != null && onPick(offer.startMin)}
    >
      {label}
      {offer.eta ? ` · ~${offer.eta}` : ""}
      {offer.recommended ? " ★" : ""}
    </Button>
  );
}
