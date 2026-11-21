import { digitsOnlyPhone } from "@/lib/whatsappInvoiceReminder";

/** wa.me link with the team's first message to the client. */
export function visitWhatsAppUrl(r: { phone: string; contact_name: string; pet_name: string | null }): string | null {
  const digits = digitsOnlyPhone(r.phone);
  if (!digits) return null;
  const pet = r.pet_name ? ` and ${r.pet_name}` : "";
  const text = `Hi ${r.contact_name.split(" ")[0]}, this is the Coro Campus – Woof team. Thanks for requesting a visit. When would suit you${pet} for the free assessment and daycare trial?`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
