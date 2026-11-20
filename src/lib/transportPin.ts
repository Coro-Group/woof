import { supabase } from "@/integrations/supabase/client";
// The same reader the server uses (copied from AE), so a pin typed or pasted as a
// long link is read in the browser and only short links need the round trip.
import { coordinateFromText, isShortMapsLink } from "../../api/_lib/mapsPin.js";
import { serviceAreaOf } from "../../api/_lib/serviceArea.js";

export type ResolvedPin = { lat: number; lng: number; source: string; area: string | null };

/** The household pin as stored on owners, or null when there is none. */
export function ownerPin(owner: { pin_lat?: number | null; pin_lng?: number | null } | null | undefined) {
  if (owner?.pin_lat == null || owner?.pin_lng == null) return null;
  return { lat: owner.pin_lat, lng: owner.pin_lng };
}

export function pinAreaLabel(lat: number | null | undefined, lng: number | null | undefined): string | null {
  return (serviceAreaOf(lat, lng) as { label: string } | null)?.label ?? null;
}

export function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/** Reads the pin out of a pasted Maps link or "lat, lng", so staff see it was found before saving. */
export async function resolveMapsPin(text: string): Promise<ResolvedPin> {
  const direct = coordinateFromText(text) as { lat: number; lng: number; source: string } | null;
  if (direct) return { ...direct, area: pinAreaLabel(direct.lat, direct.lng) };

  const link = text.trim().match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('No usable pin. Paste a Google Maps link or type "lat, lng".');

  // Short links (and links naming only a place) are followed on the server.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/transport-resolve-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ text }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => null) : null;
  if (!res?.ok || !body) {
    throw new Error(
      body?.error ??
        (isShortMapsLink(link)
          ? "Couldn't open that short link. Open it in Maps and copy the full link, or type \"lat, lng\"."
          : "No usable pin in that link."),
    );
  }
  return body as ResolvedPin;
}
