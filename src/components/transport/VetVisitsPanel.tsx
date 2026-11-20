import { useState } from "react";
import { Loader2, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { useCurrentStaffName } from "@/hooks/useTransport";
import { useOpenVetVisits, useSetVetVisitStatus, useWriteVetVisit, type VetVisitWithDetails } from "@/hooks/useTransportVet";
import { dubaiToday } from "@/lib/transportSchedule";
import {
  RETURN_TO_LABEL,
  VISIT_MODE_LABEL,
  clock12,
  legsForVisit,
  pendingLabel,
  timeToMinutes,
  visitFromRow,
  type VetVisitInput,
} from "@/lib/transportVetVisit";
import { BranchBadge } from "@/components/transport/transportShared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Vet visits still owed something (AE's VetVisitsPanel).
 *
 * The leg to the clinic is booked with the visit. The way back often is not: the vet
 * calls to say the pet is ready, or that an admitted pet can go home on Thursday. This
 * is where that call is written down, which puts the trip back on the board. A visit
 * with nothing owed is still listed while the pet is away, so nobody forgets there is
 * a dog at a clinic.
 */
export function VetVisitsPanel() {
  const visits = useOpenVetVisits();
  const today = dubaiToday();
  const rows = (visits.data ?? []).filter(
    (row) =>
      row.appointment_date >= today ||
      legsForVisit(visitFromRow(row)).pending ||
      (row.visit_mode === "admitted" && (!row.return_date || row.return_date >= today)),
  );
  if (visits.isLoading || rows.length === 0) return null;
  const owed = rows.filter((row) => legsForVisit(visitFromRow(row)).pending);
  return (
    <Card data-testid="transport-vet-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Stethoscope className="h-4 w-4" />
          Vet visits
          {owed.length > 0 && (
            <Badge variant="outline" className="ml-1 text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
              {owed.length} return{owed.length === 1 ? "" : "s"} to set
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <VetVisitRowCard key={row.id} row={row} />
        ))}
      </CardContent>
    </Card>
  );
}

function VetVisitRowCard({ row }: { row: VetVisitWithDetails }) {
  const write = useWriteVetVisit();
  const setStatus = useSetVetVisitStatus();
  const { data: staffName } = useCurrentStaffName();
  const visit = visitFromRow(row);
  const pending = legsForVisit(visit).pending;
  const [ready, setReady] = useState("");
  const [date, setDate] = useState(row.return_date ?? "");
  const [homeStart, setHomeStart] = useState("");
  const [homeEnd, setHomeEnd] = useState("");
  const owner = [row.owners?.first_name, row.owners?.last_name].filter(Boolean).join(" ");
  const pets = row.petNames.join(", ");
  const today = dubaiToday();
  const actor = staffName ?? "Staff";
  const busy = write.isPending || setStatus.isPending;

  const changeStatus = (status: "at_vet" | "returned" | "cancelled") =>
    setStatus.mutate(
      { id: row.id, status, actor },
      {
        onSuccess: () =>
          toast.success(status === "cancelled" ? "Vet visit cancelled — its trips are off the board" : status === "at_vet" ? "Marked at the vet" : "Marked returned"),
        onError: (e) => toast.error((e as Error).message),
      },
    );

  const saveReturn = () => {
    const input: VetVisitInput = { ...visit };
    if (pending === "ready_time" || pending === "return_date") {
      const m = timeToMinutes(ready);
      if (m == null) return toast.error("Give the time the pet is ready");
      input.readyTimeMin = m;
      if (row.visit_mode === "admitted") {
        if (!date) return toast.error("Give the discharge date");
        input.returnDate = date;
      }
    }
    if (pending === "home_window") {
      const start = timeToMinutes(homeStart);
      const end = timeToMinutes(homeEnd);
      if (start == null || end == null) return toast.error("Give the drop-off home window");
      input.homeWindowStartMin = start;
      input.homeWindowEndMin = end;
    }
    write.mutate(
      {
        id: row.id,
        branchId: row.branch_id,
        ownerId: row.owner_id,
        petIds: row.pet_ids,
        clinic: { id: row.vet_clinic_id, label: row.vet_label, lat: row.vet_lat ?? 0, lng: row.vet_lng ?? 0 },
        home: { lat: row.owners?.pin_lat ?? null, lng: row.owners?.pin_lng ?? null, label: null },
        notes: row.notes,
        input,
        actor,
      },
      {
        onSuccess: (r) => toast.success(r.pending ? `Saved — ${pendingLabel(r.pending)?.toLowerCase()}` : "The way back is on the board"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <div className="rounded-md border p-2 text-sm space-y-1.5" data-testid="transport-vet-visit-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium capitalize truncate flex items-center gap-1.5">
            {pets} <span className="text-muted-foreground font-normal">· {owner || "—"}</span>
            <BranchBadge branchId={row.branch_id} />
            {row.status === "at_vet" && <Badge variant="outline" className="text-[10px]">At the vet</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.vet_label} · {row.appointment_date === today ? "today" : row.appointment_date} at {clock12(row.appointment_time_min)} ·{" "}
            {VISIT_MODE_LABEL[visit.visitMode]} · {RETURN_TO_LABEL[visit.returnTo]}
            {row.return_date && row.visit_mode === "admitted" ? ` · home ${row.return_date}` : ""}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {row.status === "planned" && row.appointment_date <= today && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus("at_vet")}>
              At vet
            </Button>
          )}
          {row.status === "at_vet" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => changeStatus("returned")}>
              Returned
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => window.confirm(`Cancel ${pets}'s vet visit? Its trips come off the board.`) && changeStatus("cancelled")}
          >
            Cancel
          </Button>
        </div>
      </div>
      {pending && (
        <div className="rounded px-2 py-1.5 space-y-1.5 bg-amber-50 dark:bg-amber-950/40">
          <p className="text-xs text-amber-700 dark:text-amber-400">{pendingLabel(pending)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {(pending === "ready_time" || pending === "return_date") && (
              <>
                {row.visit_mode === "admitted" && (
                  <Input type="date" className="h-8 w-40" min={row.appointment_date} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Discharge date" />
                )}
                <Input type="time" className="h-8 w-28" value={ready} onChange={(e) => setReady(e.target.value)} aria-label="Ready at" />
              </>
            )}
            {pending === "home_window" && (
              <>
                <Input type="time" className="h-8 w-28" value={homeStart} onChange={(e) => setHomeStart(e.target.value)} aria-label="Home from" />
                <Input type="time" className="h-8 w-28" value={homeEnd} onChange={(e) => setHomeEnd(e.target.value)} aria-label="Home until" />
              </>
            )}
            <Button size="sm" className="h-8" disabled={busy} onClick={saveReturn} data-testid="transport-vet-set-return">
              {write.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Put the way back on the board
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
