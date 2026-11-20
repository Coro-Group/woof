import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useLinkVoltlinesPassenger, useSearchVoltlinesPassengers, useUnlinkVoltlinesPassenger } from "@/hooks/useVoltlines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Links one dog to a Voltlines passenger. The hub will not take a request without it. */
export function VoltlinesPetLink({
  petId,
  petName,
  passengerId,
}: {
  petId: string;
  petName: string;
  passengerId: string | null;
}) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const search = useSearchVoltlinesPassengers();
  const link = useLinkVoltlinesPassenger();
  const unlink = useUnlinkVoltlinesPassenger();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["pets"] });

  return (
    <div className="space-y-2 rounded-md border p-2" data-testid="transport-voltlines-link">
      <p className="text-xs">
        <span className="font-medium capitalize">{petName}</span>
        {passengerId ? (
          <span className="text-muted-foreground"> · Voltlines passenger {passengerId}</span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400"> · not on Voltlines yet. Link the passenger so the vans can take this request.</span>
        )}
      </p>
      <div className="flex gap-2">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search Voltlines by name"
          data-testid="transport-voltlines-search"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={term.trim().length < 2 || search.isPending}
          onClick={() => search.mutate(term.trim(), { onError: (err) => toast.error(err.message) })}
        >
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}
        </Button>
        {passengerId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unlink.isPending}
            onClick={() =>
              unlink.mutate(petId, {
                onSuccess: (res) => {
                  toast.success(res.message);
                  refresh();
                },
                onError: (err) => toast.error(err.message),
              })
            }
          >
            Unlink
          </Button>
        )}
      </div>
      {search.data && (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {search.data.passengers.length === 0 && <p className="text-xs text-muted-foreground">Nobody matches.</p>}
          {search.data.passengers.map((p) => (
            <button
              key={p.passengerId ?? p.name}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
              disabled={!p.passengerId || !!p.claimedByPetId || link.isPending}
              onClick={() =>
                p.passengerId &&
                link.mutate(
                  { petId, passengerId: p.passengerId },
                  {
                    onSuccess: (res) => {
                      toast.success(res.message);
                      refresh();
                    },
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              <span>
                {p.petName || p.name}
                {p.ownerName ? <span className="text-muted-foreground"> · {p.ownerName}</span> : null}
              </span>
              <span className="text-muted-foreground">
                {p.claimedByPetId ? `Already ${p.claimedByPetName}` : p.passengerId}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
