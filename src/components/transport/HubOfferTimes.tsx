import { Loader2, Sparkles } from "lucide-react";
import { useTransportHubQuote, useTransportHubStatus, type HubOffer, type HubQuote } from "@/hooks/useTransport";
import { OfferList, OutcomeBadge, PromiseBox, VOLTLINES_QUOTE_NOTE, quoteToPanelOffers } from "@/components/transport/OfferPanel";
import { Button } from "@/components/ui/button";

/** The offer a person accepted on the form, and the quote it came from (stored on save). */
export type AcceptedOffer = { startMin: number; slotLabel: string; eta: string | null; quote: HubQuote; index: number };

/** AE's line under an accepted offer: "Promised: 08-09AM — collected around 08:20". */
export function promiseLine(o: Pick<AcceptedOffer, "slotLabel" | "eta">): string {
  return `Promised: ${o.slotLabel}${o.eta ? ` — collected around ${o.eta}` : ""}`;
}

/** AE's words for how an offer sits against the hour asked for (OfferList). */
export function offerShiftText(o: Pick<HubOffer, "shiftHours" | "outsideWindows">): string {
  if (o.outsideWindows) return "outside the windows we publish";
  if (!o.shiftHours) return "the slot they asked for";
  return `${Math.abs(o.shiftHours)} hour ${o.shiftHours < 0 ? "earlier" : "later"}`;
}

/**
 * Offer on the new-request form — AE's Offer, before the request exists: the hub quotes
 * the hour asked for and the hours either side, shown as AE's OfferList. Accept fills
 * the time; saving stores the options and records the promise, exactly as Accept does
 * on an Inbox request. Saving before the client has chosen keeps the request Offered in
 * the Inbox with these times, to accept there once they confirm. Hidden while the hub
 * link is switched off.
 */
export function HubOfferTimes({
  petId,
  date,
  direction,
  askedStartMin,
  location,
  accepted,
  onAccept,
  onQuoted,
}: {
  petId: string | null;
  date: string | null;
  direction: "pickup" | "dropoff";
  askedStartMin: number | null;
  location?: { label: string; lat: number; lng: number } | null;
  accepted: AcceptedOffer | null;
  onAccept: (offer: AcceptedOffer | null) => void;
  /** The times the hub offered (null when asked again), so saving can keep them. */
  onQuoted?: (quote: HubQuote | null) => void;
}) {
  const status = useTransportHubStatus();
  const quote = useTransportHubQuote();
  const on = !!status.data?.enabled && !!status.data?.configured && status.data?.hub?.enabled === true;
  if (!on) return null;

  const missing = !petId ? "one dog" : !date ? "one date" : askedStartMin == null ? "the hour they asked for" : null;
  const ask = () => {
    if (!petId || !date || askedStartMin == null) return;
    onAccept(null);
    onQuoted?.(null);
    quote.mutate(
      { petId, date, direction, startMin: askedStartMin, ...(location ? { location } : {}) },
      { onSuccess: (q) => onQuoted?.(q) },
    );
  };

  if (accepted) {
    return (
      <div className="space-y-1" data-testid={`transport-hub-promise-${direction}`}>
        <PromiseBox slotLabel={accepted.slotLabel} eta={accepted.eta} />
        <p className="text-xs text-muted-foreground">
          Saving records the promise against your name and approves this trip.{" "}
          <button type="button" className="underline" onClick={() => onAccept(null)}>
            Choose again
          </button>
        </p>
      </div>
    );
  }

  const panel = quote.data ? quoteToPanelOffers(quote.data.offers) : [];
  return (
    <div className="space-y-2 rounded-md border border-dashed p-2" data-testid={`transport-hub-offers-${direction}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={ask} disabled={!!missing || quote.isPending}>
          {quote.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          {quote.data ? "Offer again" : "Offer"}
        </Button>
        {quote.data && <OutcomeBadge outcome={quote.data.outcome} />}
        {missing && <span className="text-xs text-muted-foreground">Choose {missing} first.</span>}
      </div>
      {quote.error && <p className="text-xs text-destructive">{(quote.error as Error).message}</p>}
      {quote.data && (
        <div className="space-y-2">
          {quote.data.reason && (
            <p className="text-sm rounded-md border-l-2 border-amber-500 bg-muted/50 px-3 py-2">{quote.data.reason}</p>
          )}
          <OfferList
            offers={panel}
            onAccept={(offerId) => {
              const index = Number(offerId);
              const o = quote.data?.offers[index];
              const p = panel[index];
              if (!o || !p || o.startMin == null || !quote.data) return;
              onAccept({ startMin: o.startMin, slotLabel: p.slotLabel, eta: o.eta, quote: quote.data, index });
            }}
            emptyText="No existing run can take them. The transport team will look at this one."
          />
          <p className="text-xs text-muted-foreground">
            {VOLTLINES_QUOTE_NOTE} Accepting records the promise against your name. Waiting for the client? Save
            without accepting: the request stays in the Inbox as Offered, with these times.
          </p>
        </div>
      )}
    </div>
  );
}
