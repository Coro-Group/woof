import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  formatPackageIncludes,
  type PackageCreditGrant,
  type PackageDefinition,
  type PackagePricing,
  pricingForPackageSize,
} from "@/lib/packageCatalog";
import { COMPLIMENTARY_DAYCARE_SOURCE } from "@/lib/complimentaryDaycare";
import { ownerMemberTierFromFlags } from "@/lib/memberTier";
import type { PackageWithDetails } from "@/hooks/useDaycare";

type PetSize = Database["public"]["Enums"]["pet_size"];
type ServiceCode = Database["public"]["Enums"]["service_code"];

export type GroomingPackageCatalogRow = PackageDefinition & {
  includes: string;
  prices: Record<PetSize, Pick<PackagePricing, "id" | "amount_aed"> | null>;
};

export const groomingPackageQueryKeys = {
  catalog: ["package_definitions", "grooming", "catalog"] as const,
};

export function useGroomingPackageCatalog(enabled = true) {
  return useQuery({
    queryKey: groomingPackageQueryKeys.catalog,
    enabled,
    queryFn: async () => {
      const [{ data: defs, error: defsErr }, { data: pricing, error: pricingErr }, { data: grants, error: grantsErr }] =
        await Promise.all([
          supabase
            .from("package_definitions")
            .select("*")
            .eq("category", "grooming")
            .order("sort_order"),
          supabase.from("package_pricing").select("*").eq("is_active", true),
          supabase.from("package_credit_grants").select("*"),
        ]);
      if (defsErr) throw defsErr;
      if (pricingErr) throw pricingErr;
      if (grantsErr) throw grantsErr;

      const pricingRows = (pricing ?? []) as PackagePricing[];
      const grantRows = (grants ?? []) as PackageCreditGrant[];

      return ((defs ?? []) as PackageDefinition[]).map((def) => {
        const defGrants = grantRows.filter((grant) => grant.package_def_id === def.id);
        return {
          ...def,
          includes: formatPackageIncludes(defGrants),
          prices: {
            small: pricingForPackageSize(pricingRows, def.id, "small"),
            medium: pricingForPackageSize(pricingRows, def.id, "medium"),
            large: pricingForPackageSize(pricingRows, def.id, "large"),
          },
        } satisfies GroomingPackageCatalogRow;
      });
    },
  });
}

export function useUpdateGroomingPackagePrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { pricingId: string; amount_aed: number }) => {
      const { error } = await supabase
        .from("package_pricing")
        .update({ amount_aed: args.amount_aed, updated_at: new Date().toISOString() })
        .eq("id", args.pricingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groomingPackageQueryKeys.catalog });
      queryClient.invalidateQueries({ queryKey: ["package_pricing"] });
      queryClient.invalidateQueries({ queryKey: ["package_definitions"] });
    },
  });
}

// ── useAllGroomingPackages ───────────────────────────────────────────────────

/**
 * Distinct service codes granted by active grooming package definitions.
 * Derived from package_credit_grants so the sold-credits list stays in sync
 * with the catalog instead of hardcoding (e.g. grooming_full_service, grooming_splash).
 */
async function fetchGroomingCreditCodes(): Promise<ServiceCode[]> {
  const { data: defs, error: defsErr } = await supabase
    .from("package_definitions")
    .select("id")
    .eq("category", "grooming");
  if (defsErr) throw defsErr;

  const defIds = (defs ?? []).map((d) => d.id);
  if (defIds.length === 0) return [];

  const { data: grants, error: grantsErr } = await supabase
    .from("package_credit_grants")
    .select("service_code")
    .in("package_def_id", defIds);
  if (grantsErr) throw grantsErr;

  const codes = new Set<ServiceCode>();
  for (const grant of (grants ?? []) as Pick<PackageCreditGrant, "service_code">[]) {
    if (grant.service_code) codes.add(grant.service_code);
  }
  return Array.from(codes);
}

type SoldCreditPetJoin = {
  name: string;
  owner_id: string;
  owners: {
    first_name: string;
    last_name: string | null;
    is_elite: boolean | null;
    is_vip: boolean;
  } | null;
};

type SoldCreditPurchaseGroupJoin = {
  staff_label?: string | null;
  package_definitions?: { display_name?: string | null } | null;
} | null;

export type SoldGroomingPackage = PackageWithDetails & {
  complimentaryDaycare: { total: number; used: number } | null;
};

/**
 * Cross-owner list of sold grooming credits (mirror of useAllDaycarePackages).
 * Returns the shared PackageWithDetails shape so the daycare Excel export and
 * card UI patterns can be reused. units_total/units_consumed map to
 * total_days/days_used (grooming credits are session-unit based).
 */
export function useAllGroomingPackages() {
  return useQuery({
    queryKey: ["service_credits", "grooming", "all_with_details"] as const,
    queryFn: async (): Promise<SoldGroomingPackage[]> => {
      const groomingCodes = await fetchGroomingCreditCodes();
      if (groomingCodes.length === 0) return [];

      const { data, error } = await supabase
        .from("service_credits")
        .select(
          "*, pets!inner(name, owner_id, owners(first_name, last_name, is_elite, is_vip)), purchase_groups(staff_label, package_definitions(display_name))",
        )
        .in("service_code", groomingCodes)
        .eq("is_bonus", false)
        .neq("status", "revoked")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const today = new Date().toISOString().slice(0, 10);
      const creditRows = (data ?? []) as unknown as Array<
        Database["public"]["Tables"]["service_credits"]["Row"] & {
          pets: SoldCreditPetJoin | null;
          purchase_groups?: SoldCreditPurchaseGroupJoin;
        }
      >;
      const groupIds = Array.from(
        new Set(creditRows.map((row) => row.purchase_group_id).filter((id): id is string => !!id)),
      );
      const complimentaryByKey = new Map<string, { total: number; used: number }>();
      if (groupIds.length > 0) {
        const { data: complimentary, error: complimentaryErr } = await supabase
          .from("service_credits")
          .select("purchase_group_id, pet_id, units_total, units_consumed")
          .eq("source_type", COMPLIMENTARY_DAYCARE_SOURCE)
          .neq("status", "revoked")
          .in("purchase_group_id", groupIds);
        if (complimentaryErr) throw complimentaryErr;
        for (const row of complimentary ?? []) {
          if (!row.purchase_group_id) continue;
          complimentaryByKey.set(`${row.purchase_group_id}:${row.pet_id}`, {
            total: row.units_total,
            used: row.units_consumed,
          });
        }
      }

      return creditRows.map((r) => {
        const pet = r.pets;
        const ownerJoin = pet?.owners ?? null;
        const pg = r.purchase_groups ?? null;
        const packageName =
          pg?.staff_label?.trim() || pg?.package_definitions?.display_name || null;
        const expiry = r.expires_at;

        return {
          id: r.id,
          owner_id: pet?.owner_id ?? "",
          pet_id: r.pet_id,
          total_days: r.units_total,
          days_used: r.units_consumed,
          expiry_date: expiry,
          purchase_date: r.created_at,
          package_name: packageName,
          service_code: r.service_code as ServiceCode,
          is_bonus: r.is_bonus,
          status: r.status,
          units_remaining: r.units_total - r.units_consumed,
          is_expired: !!expiry && expiry < today,
          source_ref_id: r.source_ref_id,
          redemption_group_id: r.redemption_group_id,
          is_shared_pool: false,
          shared_pool_pets_label: null,
          anchor_pet_name: pet?.name ?? null,
          pets: { name: pet?.name ?? "Pet" },
          owners: ownerJoin
            ? {
                first_name: ownerJoin.first_name,
                last_name: ownerJoin.last_name,
                is_elite: ownerJoin.is_elite,
                is_vip: ownerJoin.is_vip,
                member_tier: ownerMemberTierFromFlags(ownerJoin),
              }
            : null,
          complimentaryDaycare: r.purchase_group_id
            ? complimentaryByKey.get(`${r.purchase_group_id}:${r.pet_id}`) ?? null
            : null,
        } satisfies SoldGroomingPackage;
      });
    },
  });
}
