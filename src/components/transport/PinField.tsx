import { useRef } from "react";
import { AlertTriangle, Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { mapsUrl, resolveMapsPin, type ResolvedPin } from "@/lib/transportPin";

/**
 * A home pin, pasted as a Google Maps link or typed as "lat, lng". Ported from AE.
 *
 * Checked as soon as it is pasted (a short maps.app.goo.gl link is followed on the
 * server), so staff see where it landed before anything is saved.
 */
export type PinDraft = {
  text: string;
  pin: ResolvedPin | null;
  status: "idle" | "checking" | "ok" | "error";
  error: string | null;
};

export function emptyPin(): PinDraft {
  return { text: "", pin: null, status: "idle", error: null };
}

/** A draft showing a pin that is already saved. */
export function savedPin(lat: number | null | undefined, lng: number | null | undefined, area: string | null): PinDraft {
  if (lat == null || lng == null) return emptyPin();
  return { text: `${lat}, ${lng}`, pin: { lat, lng, source: "saved", area }, status: "ok", error: null };
}

export function pinReady(draft: PinDraft): boolean {
  return draft.status === "ok" && !!draft.pin;
}

export function PinField({
  id,
  value,
  onChange,
  placeholder = "Google Maps link or lat, lng",
  hint = "Ask the client to drop a pin in Google Maps and share it. The vans route to the pin, not the text.",
  className,
}: {
  id?: string;
  value: PinDraft;
  onChange: (next: PinDraft) => void;
  placeholder?: string;
  /** Shown while nothing has been pasted. Null to show nothing. */
  hint?: string | null;
  className?: string;
}) {
  // Only the latest check may land: a slow answer for an older paste must not win.
  const latest = useRef(0);

  const check = async (raw: string) => {
    const text = raw.trim();
    if (!text) {
      onChange(emptyPin());
      return;
    }
    const ticket = ++latest.current;
    onChange({ text: raw, pin: null, status: "checking", error: null });
    try {
      const pin = await resolveMapsPin(text);
      if (ticket === latest.current) onChange({ text: raw, pin, status: "ok", error: null });
    } catch (error) {
      if (ticket !== latest.current) return;
      onChange({
        text: raw,
        pin: null,
        status: "error",
        error: error instanceof Error ? error.message : "No usable pin in that link",
      });
    }
  };

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Input
        id={id}
        data-testid="owner-pin-input"
        placeholder={placeholder}
        value={value.text}
        onChange={(event) => onChange({ text: event.target.value, pin: null, status: "idle", error: null })}
        onBlur={(event) => {
          if (value.status === "idle") void check(event.target.value);
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (pasted) {
            event.preventDefault();
            void check(pasted);
          }
        }}
      />
      {value.status === "checking" && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Reading the pin…
        </p>
      )}
      {value.status === "ok" && value.pin && (
        <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
          <MapPin className="h-3 w-3" />
          Pin found{value.pin.area ? ` in ${value.pin.area}` : ""} ·{" "}
          <a className="underline" href={mapsUrl(value.pin.lat, value.pin.lng)} target="_blank" rel="noreferrer">
            check on the map
          </a>
        </p>
      )}
      {value.status === "error" && (
        <p className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3 w-3" /> {value.error}
        </p>
      )}
      {value.status === "idle" && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default PinField;
