import { useEffect, useMemo, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { useVisitRequests } from "@/hooks/useVisitRequests";
import { alertOpenPath, todoVisitRequests, visitRequestNotice, type VisitRequestNotice } from "@/lib/visitRequestAlerts";

export default function VisitRequestBell() {
  const { staff, isLoading } = useCurrentStaffName();
  const canSee = !isLoading && !!staff;
  const { data: visits = [] } = useVisitRequests();
  const open: VisitRequestNotice[] = useMemo(
    () => (canSee ? todoVisitRequests(visits).map(visitRequestNotice) : []),
    [canSee, visits],
  );
  const count = open.length;
  const [openMenu, setOpenMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpenMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenu]);

  if (!canSee) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={count ? `${count} new requests` : "Request notifications"}
        aria-expanded={openMenu}
        data-testid="visit-request-bell"
        onClick={() => setOpenMenu((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {count > 0 ? (
          <span
            data-testid="visit-request-bell-count"
            className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {count}
          </span>
        ) : null}
      </button>
      {openMenu ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-card shadow-lg"
        >
          <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Requests to handle</div>
          {count === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No new requests.</p>
          ) : (
            <ul className="max-h-80 overflow-auto py-1">
              {open.map((n) => (
                <li key={`${n.kind}-${n.id}`}>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted"
                    onClick={() => {
                      setOpenMenu(false);
                      navigate(alertOpenPath(n));
                    }}
                  >
                    <span className="text-sm font-medium text-foreground">{n.contactName}</span>
                    <span className="text-xs text-muted-foreground">
                      {n.pet} · {n.service}
                    </span>
                    <span className="text-xs text-muted-foreground">{requestedLabel(n.requestedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function requestedLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDistanceToNow(d, { addSuffix: true })} (${format(d, "d MMM, HH:mm")})`;
}
