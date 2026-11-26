import { BellOff } from "lucide-react";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { useVisitRequestAudioUnlock } from "@/hooks/useVisitRequestAlerts";

/** Shown only after the first click or keypress failed to unlock audio. */
export default function VisitRequestMutedBell() {
  const { staff, isLoading } = useCurrentStaffName();
  const { failed, unlock } = useVisitRequestAudioUnlock();

  if (isLoading || !staff || !failed) return null;

  return (
    <button
      type="button"
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label="Sound alerts could not start. Click to try again."
      data-testid="visit-request-muted-bell"
      onClick={() => {
        void unlock();
      }}
    >
      <BellOff className="h-4 w-4" />
    </button>
  );
}
