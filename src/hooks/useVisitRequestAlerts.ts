import { useCallback, useEffect, useState } from "react";
import {
  defaultVisitRequestAlertPrefs,
  hasVisitRequestAudioOptIn,
  isVisitRequestAudioUnlocked,
  readVisitRequestAlertPrefs,
  unlockVisitRequestAudio,
  writeVisitRequestAlertPrefs,
  VISIT_REQUEST_ALERT_PREFS_EVENT,
  VISIT_REQUEST_AUDIO_EVENT,
  type VisitRequestAlertPrefs,
} from "@/lib/visitRequestAlerts";

export function useVisitRequestAlertPrefs() {
  const [prefs, setPrefsState] = useState<VisitRequestAlertPrefs>(defaultVisitRequestAlertPrefs);

  useEffect(() => {
    const sync = () => setPrefsState(readVisitRequestAlertPrefs());
    sync();
    window.addEventListener(VISIT_REQUEST_ALERT_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(VISIT_REQUEST_ALERT_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setPrefs = useCallback((next: VisitRequestAlertPrefs | ((prev: VisitRequestAlertPrefs) => VisitRequestAlertPrefs)) => {
    setPrefsState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      return writeVisitRequestAlertPrefs(value);
    });
  }, []);

  return { prefs, setPrefs };
}

export function useVisitRequestAudioUnlock() {
  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sync = () => {
      setUnlocked(isVisitRequestAudioUnlocked());
      setFailed(hasVisitRequestAudioOptIn() && !isVisitRequestAudioUnlocked());
    };
    sync();
    window.addEventListener(VISIT_REQUEST_AUDIO_EVENT, sync);
    return () => window.removeEventListener(VISIT_REQUEST_AUDIO_EVENT, sync);
  }, []);

  const unlock = useCallback(async () => {
    const ok = await unlockVisitRequestAudio();
    setUnlocked(ok);
    setFailed(!ok);
    return ok;
  }, []);

  return { unlocked, failed, unlock };
}
