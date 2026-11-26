import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import type { SoldGroomingPackage } from "@/hooks/useGroomingPackages";
import { COMPLIMENTARY_DAYCARE_SOURCE } from "@/lib/complimentaryDaycare";
import { isSharedHouseholdDaycarePool } from "@/lib/daycareSharedPool";
import { labelForGroomingService } from "@/lib/groomingCatalog";
import {
  assignCoveredVisits,
  isUpcomingPackageAppointment,
  lineMatchesPackageUse,
  mergePackageHistory,
  parsePackageUseDateLabel,
  type GroomingPackageUsageRow,
} from "@/lib/groomingPackageStatement";

const UNKNOWN = "—";

export type GroomingPackagePurchase = {
  id: string;
  invoiceNumber: string | null;
  total: number;
  amountPaid: number;
  status: string;
  petCount: number;
};

export type ComplimentaryDaycareDetail = {
  total: number;
  used: number;
  remaining: number;
  dates: { date: string; petName: string; loggedBy: string }[];
};

export type GroomingPackageDetail = {
  packageNames: string[];
  allowsOtherPets: boolean;
  purchase: GroomingPackagePurchase | null;
  usage: GroomingPackageUsageRow[];
  upcoming: GroomingPackageUsageRow[];
  complimentary: ComplimentaryDaycareDetail | null;
};

type InvoiceLineRow = {
  description: string | null;
  invoice_id: string;
  invoices: {
    id: string;
    invoice_number: string | null;
    owner_id: string;
    status: string | null;
    service_id: string | null;
  } | null;
};

type AppointmentRow = {
  id: string;
  appointment_date: string;
  status: string | null;
  service: string | null;
  invoice_id: string | null;
  pets: { name: string | null } | null;
  grooming_stations: { name: string | null } | null;
  staff: { first_name: string | null; last_name: string | null } | null;
};

function personName(first: string | null | undefined, last: string | null | undefined): string {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || UNKNOWN;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function loadGroomingPackageDetail(
  pkg: SoldGroomingPackage,
  today: string,
): Promise<GroomingPackageDetail> {
  const { data: credit, error: creditErr } = await supabase
    .from("service_credits")
    .select("id, pet_id, service_code, units_consumed, created_at, purchase_group_id")
    .eq("id", pkg.id)
    .maybeSingle();
  if (creditErr) throw creditErr;
  if (!credit) throw new Error("Package credit was not found.");

  const purchaseGroupId = credit.purchase_group_id;
  let packageNames = [pkg.package_name?.trim() || ""].filter(Boolean);
  let purchase: GroomingPackagePurchase | null = null;
  let allowsOtherPets = false;

  if (purchaseGroupId) {
    const { data: group, error: groupErr } = await supabase
      .from("purchase_groups")
      .select("invoice_id, pet_count, staff_label, package_def_id")
      .eq("id", purchaseGroupId)
      .maybeSingle();
    if (groupErr) throw groupErr;

    let displayName: string | null = null;
    if (group?.package_def_id) {
      const { data: definition, error: definitionErr } = await supabase
        .from("package_definitions")
        .select("display_name")
        .eq("id", group.package_def_id)
        .maybeSingle();
      if (definitionErr) throw definitionErr;
      displayName = definition?.display_name?.trim() || null;
    }

    packageNames = Array.from(
      new Set([displayName, group?.staff_label?.trim(), pkg.package_name?.trim()].filter((name): name is string => !!name)),
    );

    if (group?.invoice_id) {
      const { data: invoice, error: invoiceErr } = await supabase
        .from("invoices")
        .select("id, invoice_number, total, amount_paid, status, notes")
        .eq("id", group.invoice_id)
        .maybeSingle();
      if (invoiceErr) throw invoiceErr;
      if (invoice) {
        allowsOtherPets = isSharedHouseholdDaycarePool({ invoiceNotes: invoice.notes });
        purchase = {
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          total: Number(invoice.total ?? 0),
          amountPaid: Number(invoice.amount_paid ?? 0),
          status: invoice.status ?? "",
          petCount: group.pet_count ?? 1,
        };
      }
    }
  }

  const petName = pkg.pets?.name ?? "Pet";
  const { data: siblings, error: siblingErr } = await supabase
    .from("service_credits")
    .select("id, units_consumed, created_at")
    .eq("pet_id", credit.pet_id)
    .eq("service_code", credit.service_code)
    .eq("is_bonus", false)
    .neq("status", "revoked");
  if (siblingErr) throw siblingErr;

  const { data: lineData, error: lineErr } = await supabase
    .from("invoice_line_items")
    .select("description, invoice_id, invoices!inner(id, invoice_number, owner_id, status, service_id)")
    .eq("invoices.owner_id", pkg.owner_id)
    .ilike("description", "%base covered by%");
  if (lineErr) throw lineErr;

  const lines = (lineData ?? []) as unknown as InvoiceLineRow[];
  const matched = lines.flatMap((line) => {
    const hit = lineMatchesPackageUse(line.description ?? "", packageNames, petName, allowsOtherPets);
    if (!hit || !line.invoices) return [];
    return [{ line, hit }];
  });

  const invoiceIds = Array.from(new Set(matched.map((row) => row.line.invoice_id)));
  const appointments: AppointmentRow[] = [];
  for (const ids of chunk(invoiceIds, 100)) {
    const { data, error } = await supabase
      .from("grooming_appointments")
      .select(
        "id, appointment_date, status, service, invoice_id, pets(name), grooming_stations(name), staff!grooming_appointments_groomer_id_fkey(first_name, last_name)",
      )
      .in("invoice_id", ids);
    if (error) throw error;
    appointments.push(...((data ?? []) as unknown as AppointmentRow[]));
  }

  const serviceIds = Array.from(
    new Set(
      matched
        .map((row) => row.line.invoices?.service_id)
        .filter((id): id is string => !!id && !appointments.some((appt) => appt.id === id)),
    ),
  );
  for (const ids of chunk(serviceIds, 100)) {
    const { data, error } = await supabase
      .from("grooming_appointments")
      .select(
        "id, appointment_date, status, service, invoice_id, pets(name), grooming_stations(name), staff!grooming_appointments_groomer_id_fkey(first_name, last_name)",
      )
      .in("id", ids);
    if (error) throw error;
    appointments.push(...((data ?? []) as unknown as AppointmentRow[]));
  }

  const byInvoicePet = new Map<string, AppointmentRow>();
  const byId = new Map<string, AppointmentRow>();
  for (const appt of appointments) {
    byId.set(appt.id, appt);
    const key = `${appt.invoice_id ?? ""}:${(appt.pets?.name ?? "").trim().toLowerCase()}`;
    if (!byInvoicePet.has(key)) byInvoicePet.set(key, appt);
  }

  const candidates = matched.map(({ line, hit }) => {
    const invoice = line.invoices;
    const appt =
      byInvoicePet.get(`${line.invoice_id}:${hit.petName.trim().toLowerCase()}`) ??
      (invoice?.service_id ? byId.get(invoice.service_id) : undefined);
    const date = appt?.appointment_date?.slice(0, 10) || parsePackageUseDateLabel(hit.dateLabel) || "";
    const row: GroomingPackageUsageRow = {
      date,
      petName: hit.petName,
      service: hit.service || (appt?.service ? labelForGroomingService(appt.service) : "Grooming"),
      groomer: appt ? personName(appt.staff?.first_name, appt.staff?.last_name) : UNKNOWN,
      station: appt?.grooming_stations?.name?.trim() || UNKNOWN,
      appointmentStatus: appt?.status?.replace(/_/g, " ") || UNKNOWN,
      invoiceId: invoice?.id ?? line.invoice_id,
      invoiceNumber: invoice?.invoice_number ?? null,
      invoiceStatus: invoice?.status ?? null,
      usedBy: UNKNOWN,
    };
    return row;
  });

  const unique = new Map<string, GroomingPackageUsageRow>();
  for (const row of candidates) {
    const key = `${row.invoiceId ?? ""}:${row.date}:${row.petName}:${row.service}`;
    if (!unique.has(key)) unique.set(key, row);
  }

  const slots = (siblings ?? []).map((sibling) => ({
    id: sibling.id,
    unitsConsumed: sibling.units_consumed,
    purchaseDate: sibling.created_at,
  }));
  if (!slots.some((slot) => slot.id === credit.id)) {
    slots.push({
      id: credit.id,
      unitsConsumed: credit.units_consumed,
      purchaseDate: credit.created_at,
    });
  }

  const usage = mergePackageHistory(
    assignCoveredVisits(credit.id, slots, Array.from(unique.values())),
    [],
  );
  const upcoming = usage.filter((row) => isUpcomingPackageAppointment(row.date, row.appointmentStatus, today));

  let complimentary: ComplimentaryDaycareDetail | null = null;
  if (purchaseGroupId) {
    const { data: daycareCredits, error: daycareCreditErr } = await supabase
      .from("service_credits")
      .select("id, units_total, units_consumed")
      .eq("purchase_group_id", purchaseGroupId)
      .eq("pet_id", credit.pet_id)
      .eq("source_type", COMPLIMENTARY_DAYCARE_SOURCE)
      .neq("status", "revoked")
      .limit(1);
    if (daycareCreditErr) throw daycareCreditErr;
    const daycareCredit = daycareCredits?.[0];
    if (daycareCredit) {
      const { data: sessions, error: sessionErr } = await supabase
        .from("daycare_sessions")
        .select("session_date, logged_by, pets(name)")
        .eq("package_id", daycareCredit.id)
        .order("session_date", { ascending: true });
      if (sessionErr) throw sessionErr;
      const total = daycareCredit.units_total;
      const used = daycareCredit.units_consumed;
      complimentary = {
        total,
        used,
        remaining: Math.max(0, total - used),
        dates: (sessions ?? []).map((session) => {
          const pet = session.pets as { name: string | null } | null;
          return {
            date: session.session_date,
            petName: pet?.name?.trim() || petName,
            loggedBy: session.logged_by?.trim() || UNKNOWN,
          };
        }),
      };
    }
  }

  return {
    packageNames,
    allowsOtherPets,
    purchase,
    usage,
    upcoming,
    complimentary,
  };
}

export function useGroomingPackageDetail(pkg: SoldGroomingPackage | null) {
  const today = format(new Date(), "yyyy-MM-dd");
  return useQuery({
    queryKey: ["grooming-package-detail", pkg?.id ?? null, today],
    enabled: !!pkg,
    queryFn: () => loadGroomingPackageDetail(pkg as SoldGroomingPackage, today),
  });
}
