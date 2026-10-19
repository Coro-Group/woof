import { supabase } from "@/integrations/supabase/client";
import { loadInvoiceVoidPreview } from "@/lib/voidInvoice";

/**
 * Invoice void_invoice will be called for when this unused package credit is
 * revoked. Null when a sibling credit is still active, or the purchase invoice
 * is already voided, cancelled, or consolidated.
 */
export async function invoiceToVoidForPackageRemoval(creditId: string): Promise<string | null> {
  const { data: credit, error } = await supabase
    .from("service_credits")
    .select("id, purchase_group_id")
    .eq("id", creditId)
    .maybeSingle();
  if (error) throw error;
  if (!credit?.purchase_group_id) return null;

  const { count, error: siblingError } = await supabase
    .from("service_credits")
    .select("id", { count: "exact", head: true })
    .eq("purchase_group_id", credit.purchase_group_id)
    .eq("status", "active")
    .neq("id", creditId);
  if (siblingError) throw siblingError;
  if ((count ?? 0) > 0) return null;

  const { data: group, error: groupError } = await supabase
    .from("purchase_groups")
    .select("invoice_id")
    .eq("id", credit.purchase_group_id)
    .maybeSingle();
  if (groupError) throw groupError;
  if (!group?.invoice_id) return null;

  const preview = await loadInvoiceVoidPreview(group.invoice_id);
  return preview.canVoid ? group.invoice_id : null;
}
