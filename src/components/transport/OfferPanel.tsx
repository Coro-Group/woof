import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { TONE } from "@/components/transport/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hhmm, type HubOffer, type HubQuote, type TransportRequestOffer } from "@/hooks/useTransport";

/**
 * AE's offer components (admin-essentials src/components/transport/OfferPanel.tsx and
 * the Offers section of RequestDetailSheet), ported as they are so an offer reads and is
 * confirmed the same way in both apps.
 */

export type PanelOffer = {
  offerId: string | null;
  slotLabel: string;
  /** The van arrives outside every published window, so slotLabel is a time, not a window. */
  outsideWindows?: boolean;
  shiftHours: number;
  eta: string;
  /** What the detour costs. null when the quote did not carry it (AE's partner link
  * sends no km/min today), so nothing prints "0 km / 0 min" as if it were free. */
  addedKm: number | null;
  addedMinutes: number | null;
  displaces: number;
  rank?: number;
  recommended?: boolean;
};

export const VOLTLINES_QUOTE_NOTE = "These times come from Voltlines route data, not a person.";

const km = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n) * 10) / 10);
const mins = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n)));

/** What the client is told, from what was stored (AE storedToPanelOffers). */
export function storedToPanelOffers(rows: TransportRequestOffer[]): PanelOffer[] {
  return rows.map((o) => {
    const promised = o.outside_windows ? null : o.promised_slot_label ?? o.slot_label;
    return {
      offerId: o.id,
      slotLabel: promised ?? "around " + hhmm(o.eta_min),
      outsideWindows: !promised,
      shiftHours: o.shift_hours ?? 0,
      eta: hhmm(o.eta_min),
      addedKm: km(o.added_km),
      addedMinutes: mins(o.added_minutes),
      displaces: o.displaces ?? 0,
      rank: o.rank,
      recommended: o.recommended,
    };
  });
}

/** A live quote, before it is stored (AE OfferPanel's mapping). */
export function quoteToPanelOffers(offers: HubOffer[]): PanelOffer[] {
  return offers.map((o, i) => {
    const promised = o.outsideWindows ? null : o.promisedSlotLabel ?? o.slotLabel;
    return {
      offerId: String(i),
      slotLabel: promised ?? "around " + (o.eta ?? "—"),
      outsideWindows: !promised,
      shiftHours: o.shiftHours ?? 0,
      eta: o.eta ?? "—",
      addedKm: km(o.addedKm),
      addedMinutes: mins(o.addedMinutes),
      displaces: o.displaces ?? 0,
      rank: i + 1,
      recommended: o.recommended === true,
    };
  });
}

/** AE's outcome badge on a quote. */
export function OutcomeBadge({ outcome }: { outcome: HubQuote["outcome"] }) {
  if (outcome === "cancellation") return <Badge variant="secondary">Cancellation</Badge>;
  if (outcome === "escalate") return <Badge variant="destructive">Escalate</Badge>;
  if (outcome === "offer_off_window") return <Badge className="bg-amber-500 hover:bg-amber-500">Outside the usual window</Badge>;
  return <Badge className="bg-emerald-600 hover:bg-emerald-600">Can offer</Badge>;
}

/** AE's OfferList, word for word. */
export function OfferList({
  offers,
  declined,
  onToggleDeclined,
  onAccept,
  accepting,
  readOnly,
  emptyText,
}: {
  offers: PanelOffer[];
  declined?: string[];
  onToggleDeclined?: (offerId: string) => void;
  onAccept?: (offerId: string | null) => void;
  accepting?: boolean;
  readOnly?: boolean;
  emptyText: string;
}) {
  return (
    <div className="divide-y rounded-md border" data-testid="transport-offer-list">
      {offers.map((o, i) => (
        <div key={o.offerId ?? `${o.slotLabel}-${i}`} className="p-3 flex items-center gap-4" data-testid="transport-offer">
          <div className="flex-1 min-w-0">
            <div className="font-medium flex items-center gap-2 flex-wrap">
              <span>{o.slotLabel}</span>
              {o.recommended && (
                <Badge variant="outline" className={`text-[10px] ${TONE.good.badge}`}>
                  Recommended
                </Badge>
              )}
              <span className="text-muted-foreground font-normal">
                {o.outsideWindows
                  ? "— outside the windows we publish"
                  : o.shiftHours === 0
                    ? "— the slot they asked for"
                    : `— ${Math.abs(o.shiftHours)} hour ${o.shiftHours < 0 ? "earlier" : "later"}`}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Collected around <span className="font-mono">{o.eta}</span>
              {o.addedKm != null && o.addedMinutes != null && ` · costs ${o.addedKm} km / ${o.addedMinutes} min`}
              {o.displaces > 0 && <span className="text-destructive"> · pushes {o.displaces} client(s) out</span>}
            </p>
          </div>
          {/* Displacing an existing client is a manager's trade (in AE), never a one-click accept. */}
          {!readOnly && o.displaces > 0 && (
            <Badge variant="outline" className={`shrink-0 ${TONE.critical.badge}`}>
              would push {o.displaces} client{o.displaces === 1 ? "" : "s"} out — manager only
            </Badge>
          )}
          {!readOnly && o.displaces === 0 && (
            <div className="flex items-center gap-2 shrink-0">
              {onToggleDeclined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!o.offerId}
                  className={o.offerId && declined?.includes(o.offerId) ? "text-destructive" : ""}
                  onClick={() => o.offerId && onToggleDeclined(o.offerId)}
                  title="Client turned this down"
                >
                  Declined
                </Button>
              )}
              <Button type="button" size="sm" disabled={accepting} onClick={() => onAccept?.(o.offerId ?? null)}>
                {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                <span className="ml-1">Accept</span>
              </Button>
            </div>
          )}
        </div>
      ))}
      {!offers.length && <p className="p-3 text-sm text-muted-foreground">{emptyText}</p>}
    </div>
  );
}

/** AE's leg heading: "Pickup · Thu 20 Nov", "Drop-off · every Monday". */
export function legLabel(leg: { direction: string; service_date: string | null; weekday: number | null }) {
  const direction = leg.direction === "dropoff" ? "Drop-off" : leg.direction === "pickup" ? "Pickup" : "Direction not set";
  if (leg.service_date) {
    const day = new Date(`${leg.service_date}T00:00:00`);
    return `${direction} · ${Number.isNaN(day.getTime()) ? leg.service_date : format(day, "EEE d MMM")}`;
  }
  if (leg.weekday != null) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `${direction} · every ${names[leg.weekday]}`;
  }
  return direction;
}

/** AE's green promise box on an accepted leg. */
export function PromiseBox({
  slotLabel,
  eta,
  acceptedAt,
}: {
  slotLabel: string | null;
  eta: string | null;
  acceptedAt?: string | null;
}) {
  return (
    <div className={`rounded-md border p-3 text-sm ${TONE.good.bg} ${TONE.good.border}`} data-testid="transport-offer-promise">
      {slotLabel ? (
        <p className={`font-medium ${TONE.good.text}`}>
          Promised: {slotLabel}
          {eta ? (
            <>
              {" "}
              — collected around <span className="font-mono">{eta}</span>
            </>
          ) : null}
        </p>
      ) : (
        <p className={`font-medium ${TONE.good.text}`}>
          Promise recorded{acceptedAt ? ` on ${format(new Date(acceptedAt), "d MMM")}` : ""}.
        </p>
      )}
    </div>
  );
}

/**
 * AE's same-day confirm: when the dog is already booked that day and way, ask before
 * approving ("Approve and override"). `ask(messages, go)` opens it; render `dialog`.
 */
export function useSameDayConfirm() {
  const [pending, setPending] = useState<{ messages: string[]; go: () => void } | null>(null);
  const ask = (messages: string[], go: () => void) => {
    if (!messages.length) return go();
    setPending({ messages, go });
  };
  const dialog: ReactNode = (
    <AlertDialog open={pending != null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Already scheduled for this day</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {(pending?.messages ?? []).map((m) => (
                <p key={m}>{m}</p>
              ))}
              <p className="font-medium text-foreground">If you approve, it will override the previously approved time. Continue?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const next = pending?.go;
              setPending(null);
              next?.();
            }}
          >
            Approve and override
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask, dialog };
}

/** Run an action, toasting AE's message or the error. */
export function runWithToast<T extends { message: string }>(p: Promise<T>) {
  p.then((r) => toast.success(r.message)).catch((e: Error) => toast.error(e.message));
}
