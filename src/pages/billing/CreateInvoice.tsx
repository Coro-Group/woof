import { useEffect, useMemo, useRef, useState } from "react";
import { OwnerSearchPopover } from "@/components/billing/OwnerSearchPopover";
import { format } from "date-fns";
import { useNavigate, useSearchParams } from "react-router-dom";
import TopBar from "@/components/dashboard/TopBar";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useInvoicePricingRows } from "@/hooks/useInvoicePricingRows";
import { useOwner } from "@/hooks/useOwners";
import { usePets } from "@/hooks/usePets";
import { ownerDisplayName } from "@/lib/bookingUtils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { InvoiceAdjustmentAmountInput } from "@/components/billing/InvoiceAdjustmentAmountInput";
import {
  discountReasonWithMode,
  type InvoiceDiscountMode,
  isPercentDiscountAdjustmentType,
  resolveAdjustmentDiscountAmount,
} from "@/lib/invoiceAdjustmentDiscount";
import {
  netFromGrossInclusive,
  vatAmountFromGrossInclusive,
  vatLineLabel,
} from "@/lib/vatConfig";
import { cn } from "@/lib/utils";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceLineInsert = Database["public"]["Tables"]["invoice_line_items"]["Insert"];
type AdjustmentInsert = Database["public"]["Tables"]["billing_adjustments"]["Insert"];

type LineDraft = {
  id: string;
  description: string;
  pricingKey: string;
  customMode: boolean;
  quantity: number;
  unitPrice: number;
  total: number;
  discount: number;
  vat: number;
};

type AdjustmentDraft = {
  id: string;
  adjustment_type: string;
  amount: number;
  discountMode: InvoiceDiscountMode;
  reason: string;
  approved_by: string;
};

function resolvedAdjustmentAmount(adjustment: AdjustmentDraft, subtotal: number): number {
  return resolveAdjustmentDiscountAmount(
    isPercentDiscountAdjustmentType(adjustment.adjustment_type)
      ? adjustment.discountMode
      : "flat",
    adjustment.amount,
    subtotal,
  );
}

function aed(v: number) {
  return `AED ${v.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function petChipLabel(name: string, breed: string | null | undefined) {
  const breedLabel = breed?.trim();
  return breedLabel ? `${name} · ${breedLabel}` : name;
}

function emptyLineDraft(description = ""): LineDraft {
  return {
    id: crypto.randomUUID(),
    description,
    pricingKey: "",
    customMode: false,
    quantity: 1,
    unitPrice: 0,
    total: 0,
    discount: 0,
    vat: 0,
  };
}

export default function CreateInvoicePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetOwnerId = searchParams.get("ownerId") ?? "";
  const [ownerId, setOwnerId] = useState<string>(presetOwnerId);
  const [ownerLabel, setOwnerLabel] = useState("");
  const [selectedPetIds, setSelectedPetIds] = useState<string[]>([]);
  const [serviceType, setServiceType] = useState("other");
  const [dueDate, setDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([emptyLineDraft()]);
  const [adjustments, setAdjustments] = useState<AdjustmentDraft[]>([]);

  const { data: owner } = useOwner(ownerId || "");
  // Same fetch as Customer Profile pets section.
  const { data: pets = [], isLoading: petsLoading } = usePets(ownerId || "");
  const ownerPets = useMemo(
    () => [...pets].sort((a, b) => a.name.localeCompare(b.name)),
    [pets],
  );
  const selectedPets = useMemo(
    () => ownerPets.filter((p) => selectedPetIds.includes(p.id)),
    [ownerPets, selectedPetIds],
  );
  const allPetsSelected =
    ownerPets.length > 0 && selectedPetIds.length === ownerPets.length;

  useEffect(() => {
    if (!owner?.id || owner.id !== ownerId) return;
    setOwnerLabel(ownerDisplayName(owner.first_name, owner.last_name));
  }, [owner, ownerId]);

  useEffect(() => {
    setSelectedPetIds([]);
  }, [ownerId]);

  const linesRef = useRef(lines);
  linesRef.current = lines;
  const { data: pricingRows = [] } = useInvoicePricingRows();

  const togglePet = (petId: string) => {
    setSelectedPetIds((prev) =>
      prev.includes(petId) ? prev.filter((id) => id !== petId) : [...prev, petId],
    );
  };

  const toggleSelectAllPets = () => {
    setSelectedPetIds(allPetsSelected ? [] : ownerPets.map((p) => p.id));
  };

  const addLine = () => {
    // Single selected pet → prefill description; otherwise blank line.
    const description =
      selectedPets.length === 1 ? selectedPets[0].name : "";
    setLines((prev) => [...prev, emptyLineDraft(description)]);
  };

  const addLinePerSelectedPet = () => {
    if (selectedPets.length === 0) {
      toast.error("Select at least one pet first.");
      return;
    }
    setLines((prev) => [
      ...prev,
      ...selectedPets.map((pet) => emptyLineDraft(pet.name)),
    ]);
  };

  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));
  const patchLine = (id: string, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const resolveLine = async (line: LineDraft) => {
    if (line.customMode) {
      patchLine(line.id, {
        total: line.unitPrice * line.quantity,
        discount: 0,
        vat: 0,
      });
      return;
    }
    if (!line.pricingKey || !line.quantity) return;
    const { data, error } = await supabase.rpc("resolve_woof_service_rate", {
      p_service_code: line.pricingKey as Database["public"]["Enums"]["service_code"],
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = (data as Database["public"]["Functions"]["resolve_woof_service_rate"]["Returns"])[0];
    if (!row) return;
    patchLine(line.id, {
      unitPrice: row.amount_aed,
      total: row.amount_aed * line.quantity,
      discount: 0,
      vat: 0,
    });
  };

  useEffect(() => {
    if (!ownerId || !owner?.id) return;
    let cancelled = false;
    (async () => {
      for (const line of linesRef.current) {
        if (cancelled) return;
        if (line.customMode || !line.pricingKey || !line.quantity) continue;
        const { data, error } = await supabase.rpc("resolve_woof_service_rate", {
          p_service_code: line.pricingKey as Database["public"]["Enums"]["service_code"],
        });
        if (error || cancelled) continue;
        const row = (data as Database["public"]["Functions"]["resolve_woof_service_rate"]["Returns"])[0];
        if (!row) continue;
        if (cancelled) return;
        setLines((prev) =>
          prev.map((l) =>
            l.id === line.id
              ? {
                  ...l,
                  unitPrice: row.amount_aed,
                  total: row.amount_aed * line.quantity,
                  discount: 0,
                  vat: 0,
                }
              : l,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, owner?.id]);

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const lineDiscount = lines.reduce((s, l) => s + l.discount, 0);
  const lineTotal = lines.reduce((s, l) => s + l.total, 0);
  const adjustmentTotal = adjustments.reduce(
    (s, a) => s + resolvedAdjustmentAmount(a, subtotal),
    0,
  );
  const invoiceGross = Math.max(0, lineTotal - adjustmentTotal);
  const vatAed = vatAmountFromGrossInclusive(invoiceGross);
  const netExVat = netFromGrossInclusive(invoiceGross);

  const submit = async () => {
    if (!ownerId) return toast.error("Owner is required.");
    if (lines.length === 0) return toast.error("Add at least one line item.");
    if (lines.some((l) => !l.customMode && !l.pricingKey)) {
      return toast.error("Select pricing keys for non-custom lines.");
    }
    if (lines.some((l) => !l.description.trim())) {
      return toast.error("Each line needs a description.");
    }
    setSaving(true);
    try {
      const invoicePayload: InvoiceInsert = {
        owner_id: ownerId,
        service_type: serviceType,
        status: "finalised",
        due_date: dueDate,
        notes: notes.trim() || null,
        subtotal,
        
        discount_amount: lineDiscount + adjustmentTotal,
        
        discount_pct: subtotal > 0 ? ((lineDiscount + adjustmentTotal) / subtotal) * 100 : 0,
        total: invoiceGross,
        vat_aed: vatAed,
      };
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert(invoicePayload)
        .select("id")
        .single();
      if (invErr) throw invErr;

      const lineRows: InvoiceLineInsert[] = lines.map((l, idx) => ({
        invoice_id: inv.id,
        description: l.description.trim(),
        pricing_key: l.customMode ? null : l.pricingKey,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        total_price: l.total,
        line_total: l.total,
        service_type: serviceType,
        sort_order: idx,
      }));
      const { error: linesErr } = await supabase.from("invoice_line_items").insert(lineRows);
      if (linesErr) throw linesErr;

      if (adjustments.length > 0) {
        const adjRows: AdjustmentInsert[] = adjustments.map((a) => ({
          owner_id: ownerId,
          invoice_id: inv.id,
          adjustment_type: a.adjustment_type,
          original_amount: subtotal,
          adjusted_amount: resolvedAdjustmentAmount(a, subtotal),
          reason: discountReasonWithMode(
            a.reason,
            isPercentDiscountAdjustmentType(a.adjustment_type) ? a.discountMode : "flat",
            a.amount,
          ),
          approved_by: a.approved_by,
        }));
        const { error: adjErr } = await supabase.from("billing_adjustments").insert(adjRows);
        if (adjErr) throw adjErr;
      }

      toast.success("Invoice created.");
      navigate(`/billing/invoices/${inv.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create invoice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TopBar title="Create Manual Invoice" />
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <Card>
          <CardContent className="p-5 space-y-4">
            <OwnerSearchPopover
              ownerId={ownerId || undefined}
              ownerLabel={ownerLabel}
              placeholder="Search owner by name or phone"
              inputTestId="billing-create-invoice-owner-search"
              onSelect={(id, label) => {
                setOwnerId(id);
                setOwnerLabel(label);
              }}
              onClear={() => {
                setOwnerId("");
                setOwnerLabel("");
                setSelectedPetIds([]);
              }}
            />

            {ownerId && owner?.id === ownerId && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Selected client</span>
                  <span className="text-sm font-semibold">{ownerLabel}</span>
                </div>

                <div className="space-y-2" data-testid="billing-create-invoice-pets">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm">Pets on this invoice</Label>
                    {ownerPets.length > 0 && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={allPetsSelected}
                          onCheckedChange={() => toggleSelectAllPets()}
                          data-testid="billing-create-invoice-select-all-pets"
                        />
                        Select all
                      </label>
                    )}
                  </div>
                  {petsLoading ? (
                    <p className="text-sm text-muted-foreground">Loading pets…</p>
                  ) : ownerPets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No pets on this client.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {ownerPets.map((pet) => {
                        const checked = selectedPetIds.includes(pet.id);
                        return (
                          <label
                            key={pet.id}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors",
                              checked
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-input bg-background text-muted-foreground hover:bg-muted/40",
                            )}
                            data-testid={`billing-create-invoice-pet-${pet.id}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => togglePet(pet.id)}
                            />
                            <span>{petChipLabel(pet.name, pet.breed)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {selectedPets.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Selected pets prefill line descriptions; use “Add line per pet” for one
                      charge row each.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Service type</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                  {["boarding", "daycare", "grooming", "transport", "training", "retail", "membership", "other"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Due date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Pricing basis</Label>
                <Input className="max-w-[14rem]" value="Woof service rates" disabled />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Line items</h3>
              <div className="flex flex-wrap gap-2">
                {selectedPets.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addLinePerSelectedPet}
                    data-testid="billing-create-invoice-add-line-per-pet"
                  >
                    Add line per pet ({selectedPets.length})
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                  data-testid="billing-create-invoice-add-line"
                >
                  Add line
                </Button>
              </div>
            </div>
            {lines.map((line) => (
              <div key={line.id} className="rounded-md border p-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="md:col-span-2 space-y-1">
                    <Label>Description</Label>
                    <Input value={line.description} onChange={(e) => patchLine(line.id, { description: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Pricing key</Label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={line.customMode ? "__custom__" : line.pricingKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        const custom = val === "__custom__";
                        patchLine(line.id, { customMode: custom, pricingKey: custom ? "" : val });
                      }}
                    >
                      <option value="">Select key</option>
                      {pricingRows.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label} ({p.key})
                        </option>
                      ))}
                      <option value="__custom__">Custom</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) => patchLine(line.id, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      onBlur={() => resolveLine(line)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Unit price</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.unitPrice}
                      onChange={(e) => patchLine(line.id, { unitPrice: Number(e.target.value) || 0 })}
                      onBlur={() => resolveLine(line)}
                      disabled={!line.customMode}
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-4">
                  <span>Discount: {aed(line.discount)}</span>
                  <span>VAT: {aed(line.vat)}</span>
                  <span className="font-medium text-foreground">Line total: {aed(line.total)}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => removeLine(line.id)}>Remove</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Adjustments (optional)</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setAdjustments((prev) => [
                    ...prev,
                    {
                      id: crypto.randomUUID(),
                      adjustment_type: "discount_override",
                      amount: 0,
                      discountMode: "percent",
                      reason: "",
                      approved_by: "",
                    },
                  ])
                }
              >
                Add adjustment
              </Button>
            </div>
            {adjustments.map((a) => (
              <div key={a.id} className="grid gap-3 md:grid-cols-4 rounded-md border p-3">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={a.adjustment_type}
                  onChange={(e) => setAdjustments((prev) => prev.map((x) => x.id === a.id ? { ...x, adjustment_type: e.target.value } : x))}
                >
                  <option value="discount_override">Discount</option>
                  <option value="goodwill_credit">Goodwill credit</option>
                  <option value="fee_waived">Fee waived</option>
                  <option value="adjustment">Adjustment</option>
                </select>
                <div className="md:col-span-3 grid gap-3 md:grid-cols-3">
                  <InvoiceAdjustmentAmountInput
                    adjustmentType={a.adjustment_type}
                    subtotal={subtotal}
                    mode={a.discountMode}
                    onModeChange={(discountMode) =>
                      setAdjustments((prev) =>
                        prev.map((x) => (x.id === a.id ? { ...x, discountMode } : x)),
                      )
                    }
                    value={a.amount ? String(a.amount) : ""}
                    onValueChange={(raw) =>
                      setAdjustments((prev) =>
                        prev.map((x) =>
                          x.id === a.id ? { ...x, amount: Number(raw) || 0 } : x,
                        ),
                      )
                    }
                  />
                  <Input placeholder="Reason" value={a.reason} onChange={(e) => setAdjustments((prev) => prev.map((x) => x.id === a.id ? { ...x, reason: e.target.value } : x))} />
                  <Input placeholder="Approved by" value={a.approved_by} onChange={(e) => setAdjustments((prev) => prev.map((x) => x.id === a.id ? { ...x, approved_by: e.target.value } : x))} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="md:max-w-md ml-auto text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{aed(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discounts</span><span>-{aed(lineDiscount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Adjustments</span><span>-{aed(adjustmentTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Net (ex VAT)</span><span>{aed(netExVat)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{vatLineLabel()}</span><span>{aed(vatAed)}</span></div>
              <div className="flex justify-between text-base font-semibold border-t pt-2"><span>Total (incl. VAT)</span><span>{aed(invoiceGross)}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => navigate("/billing/invoices")}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Creating..." : "Create invoice"}</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
