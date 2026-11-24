import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type PackageDayRow = {
  id: string;
  code: string;
  display_name: string;
  category: string;
  complimentary_daycare_days: number;
};

export function ComplimentaryDaycareSettings() {
  const { staff } = useCurrentStaffName();
  const isAdmin = staff?.role === "admin";
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const packages = useQuery({
    queryKey: ["package_definitions", "complimentary_daycare"] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("package_definitions")
        .select("id, code, display_name, category, complimentary_daycare_days")
        .eq("is_active", true)
        .order("category")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as PackageDayRow[];
    },
  });

  const save = useMutation({
    mutationFn: async (row: PackageDayRow) => {
      const days = Number.parseInt(draft[row.id] ?? String(row.complimentary_daycare_days), 10);
      if (!Number.isInteger(days) || days < 0) {
        throw new Error("Enter a whole number, 0 or more.");
      }
      const { error } = await supabase.rpc("set_package_complimentary_daycare_days", {
        p_package_def_id: row.id,
        p_days: days,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Complimentary daycare days saved.");
      queryClient.invalidateQueries({ queryKey: ["package_definitions"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not save complimentary days.");
    },
  });

  if (!isAdmin) return null;

  return (
    <section className="flex flex-col gap-3" data-testid="settings-complimentary-daycare">
      <div>
        <h2 className="text-lg font-semibold">Complimentary daycare days</h2>
        <p className="text-sm text-muted-foreground">
          Days added when this package is sold from 24 Nov 2026. Summer Splash is 2. Packages sold
          before that date are unchanged.
        </p>
      </div>
      {packages.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : packages.isError ? (
        <p className="text-sm text-destructive">
          Complimentary daycare settings are not available until the database update is applied.
        </p>
      ) : (
        <div className="rounded-lg border divide-y">
          {(packages.data ?? []).map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{row.display_name}</p>
                <p className="text-xs text-muted-foreground truncate">{row.category}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-16"
                  inputMode="numeric"
                  aria-label={`Complimentary daycare days for ${row.display_name}`}
                  value={draft[row.id] ?? String(row.complimentary_daycare_days)}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [row.id]: event.target.value }))}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => save.mutate(row)}
                >
                  Save
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
