import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { useVisitRequestAlertPrefs, useVisitRequestAudioUnlock } from "@/hooks/useVisitRequestAlerts";
import { useVisitRequests, type VisitRequest } from "@/hooks/useVisitRequests";
import { supabase } from "@/integrations/supabase/client";
import {
  VISIT_REQUEST_ALARM_CHANNEL,
  VISIT_REQUEST_ALERT_BRAND,
  alarmBannerForPayload,
  alertOpenPath,
  isTodoVisitRequest,
  isVisitRequestAlarmPlaying,
  newestNewVisitRequest,
  startVisitRequestAlarm,
  stopVisitRequestAlarm,
  todoVisitRequests,
  visitRequestAlarmPayload,
  visitRequestNewToast,
  visitRequestTabTitle,
  type VisitRequestAlarmMessage,
  type VisitRequestAlarmPayload,
} from "@/lib/visitRequestAlerts";

const EMPTY: VisitRequest[] = [];

/** Tab title, toast, looping alarm, and realtime refresh. Mount once in the staff shell. */
export default function VisitRequestAlertHost() {
  const { staff, isLoading } = useCurrentStaffName();
  const canSee = !isLoading && !!staff;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const visitsQuery = useVisitRequests();
  const visitRows = canSee ? (visitsQuery.data ?? EMPTY) : EMPTY;
  const openCount = todoVisitRequests(visitRows).length;
  const isFetched = visitsQuery.isFetched;
  const seenIds = useRef<Set<string> | null>(null);
  const { prefs } = useVisitRequestAlertPrefs();
  const { unlocked, unlock } = useVisitRequestAudioUnlock();
  const [ringing, setRinging] = useState<VisitRequestAlarmPayload | null>(null);
  const prefsRef = useRef(prefs);
  const unlockedRef = useRef(unlocked);
  const ringingRef = useRef(ringing);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  prefsRef.current = prefs;
  unlockedRef.current = unlocked;
  ringingRef.current = ringing;

  const clearBannerTimer = () => {
    if (bannerTimer.current) {
      clearTimeout(bannerTimer.current);
      bannerTimer.current = null;
    }
  };

  const postAlarm = useCallback((msg: VisitRequestAlarmMessage) => {
    try {
      channelRef.current?.postMessage(msg);
    } catch {
      /* ignore */
    }
  }, []);

  const silence = useCallback(
    (broadcast: boolean) => {
      stopVisitRequestAlarm({ silent: true });
      clearBannerTimer();
      setRinging(null);
      if (broadcast) postAlarm({ type: "stop" });
    },
    [postAlarm],
  );

  const beginRing = useCallback(
    (row: VisitRequestAlarmPayload, fromPeer: boolean) => {
      stopVisitRequestAlarm({ silent: true });
      clearBannerTimer();
      setRinging(row);
      const p = prefsRef.current;
      const ms = p.durationSec * 1000;
      const finish = () => silence(!fromPeer);
      if (p.enabled && unlockedRef.current) {
        const played = startVisitRequestAlarm({
          volume: p.volume,
          durationMs: ms,
          style: p.style,
          kind: row.kind,
          onEnded: finish,
        });
        if (!played) bannerTimer.current = setTimeout(finish, ms);
      } else {
        bannerTimer.current = setTimeout(finish, ms);
      }
      if (!fromPeer) postAlarm({ type: "start", request: row });
    },
    [postAlarm, silence],
  );

  useEffect(() => {
    if (!canSee) return;
    const onGesture = () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      void unlock();
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
  }, [canSee, unlock]);

  useEffect(() => {
    if (!canSee) {
      document.title = VISIT_REQUEST_ALERT_BRAND;
      return;
    }
    document.title = visitRequestTabTitle(openCount);
    return () => {
      document.title = VISIT_REQUEST_ALERT_BRAND;
    };
  }, [canSee, openCount]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(VISIT_REQUEST_ALARM_CHANNEL);
    channelRef.current = bc;
    bc.onmessage = (event: MessageEvent<VisitRequestAlarmMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "stop") silence(false);
      if (msg.type === "start" && msg.request) beginRing(msg.request, true);
    };
    return () => {
      bc.close();
      channelRef.current = null;
    };
  }, [beginRing, silence]);

  useEffect(() => {
    if (!canSee || !isFetched) return;
    if (seenIds.current === null) {
      seenIds.current = new Set(visitRows.map((row) => row.id));
      return;
    }
    const newest = newestNewVisitRequest(visitRows, seenIds.current);
    for (const row of visitRows) {
      if (row.status === "new" && !seenIds.current.has(row.id)) {
        toast.message(visitRequestNewToast(row.contact_name));
      }
      seenIds.current.add(row.id);
    }
    if (!prefsRef.current.enabled || !newest) return;
    beginRing(
      visitRequestAlarmPayload({
        id: newest.id,
        contact_name: newest.contact_name,
        pet_name: newest.pet_name,
        interest: newest.interest,
        created_at: newest.created_at,
      }),
      false,
    );
  }, [beginRing, canSee, isFetched, visitRows]);

  useEffect(() => {
    if (!ringing) return;
    const stillOpen = visitRows.some((row) => row.id === ringing.id && isTodoVisitRequest(row.status));
    if (!stillOpen) silence(true);
  }, [ringing, silence, visitRows]);

  useEffect(() => {
    if (!prefs.enabled && ringingRef.current) silence(true);
  }, [prefs.enabled, silence]);

  const wasUnlocked = useRef(unlocked);
  useEffect(() => {
    const justUnlocked = unlocked && !wasUnlocked.current;
    wasUnlocked.current = unlocked;
    const current = ringingRef.current;
    if (!justUnlocked || !prefs.enabled || !current || isVisitRequestAlarmPlaying()) return;
    clearBannerTimer();
    stopVisitRequestAlarm({ silent: true });
    const ms = prefs.durationSec * 1000;
    const played = startVisitRequestAlarm({
      volume: prefs.volume,
      durationMs: ms,
      style: prefs.style,
      kind: current.kind,
      onEnded: () => silence(true),
    });
    if (!played) bannerTimer.current = setTimeout(() => silence(true), ms);
  }, [unlocked, prefs.enabled, prefs.durationSec, prefs.volume, prefs.style, silence]);

  useEffect(() => {
    if (!canSee) return;
    const channel = supabase
      .channel("woof-visit-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "visit_requests" }, () => {
        void qc.invalidateQueries({ queryKey: ["visit-requests"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canSee, qc]);

  useEffect(
    () => () => {
      stopVisitRequestAlarm({ silent: true });
      clearBannerTimer();
    },
    [],
  );

  if (!canSee || !ringing) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 bg-red-600 px-3 py-2 text-sm text-white md:px-8"
      data-testid="visit-request-alarm-banner"
      role="alert"
    >
      <span className="font-medium">{alarmBannerForPayload(ringing)}</span>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="visit-request-alarm-open"
          onClick={() => {
            const path = alertOpenPath({
              id: ringing.id,
              kind: ringing.kind,
              visitDate: ringing.visit_date,
            });
            silence(true);
            navigate(path);
          }}
        >
          Open
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
          data-testid="visit-request-alarm-stop"
          onClick={() => silence(true)}
        >
          Stop sound
        </Button>
      </div>
    </div>
  );
}
