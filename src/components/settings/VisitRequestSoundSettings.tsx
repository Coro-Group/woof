import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useCurrentStaffName } from "@/hooks/useCurrentStaffName";
import { useVisitRequestAlertPrefs } from "@/hooks/useVisitRequestAlerts";
import {
  clampVisitRequestAlertDurationSec,
  unlockAndPlayVisitRequestPreview,
  VISIT_REQUEST_ALARM_MAX_DURATION_SEC,
  VISIT_REQUEST_ALARM_MIN_DURATION_SEC,
  type VisitRequestSoundStyle,
} from "@/lib/visitRequestAlerts";

export default function VisitRequestSoundSettings() {
  const { staff, isLoading } = useCurrentStaffName();
  const { prefs, setPrefs } = useVisitRequestAlertPrefs();
  const [duration, setDuration] = useState(String(prefs.durationSec));
  const [testing, setTesting] = useState<"visit" | "assessment" | null>(null);

  useEffect(() => {
    setDuration(String(prefs.durationSec));
  }, [prefs.durationSec]);

  if (isLoading || !staff) return null;

  const setStyle = (style: VisitRequestSoundStyle) => setPrefs({ ...prefs, style });
  const test = (kind: "visit" | "assessment") => {
    setTesting(kind);
    void unlockAndPlayVisitRequestPreview({ volume: prefs.volume, style: prefs.style, kind }).finally(() =>
      setTesting(null),
    );
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <Label>Request alerts</Label>
        <p className="text-xs text-muted-foreground">
          A chime plays when a new Visit Request arrives. Visit requests use the G–C–E chime and “New booking request”.
          The red badge, bell, and tab title stay on when the sound is off.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs.enabled}
            onChange={(e) => setPrefs({ ...prefs, enabled: e.target.checked })}
            data-testid="visit-request-sound-enabled"
          />
          Alert sound on
        </label>
        <fieldset className="grid gap-1.5 text-sm" disabled={!prefs.enabled}>
          <legend className="mb-1">Sound style</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="visit-request-sound-style"
              checked={prefs.style === "chime_voice"}
              onChange={() => setStyle("chime_voice")}
              data-testid="visit-request-sound-style-voice"
            />
            Chime + voice
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="visit-request-sound-style"
              checked={prefs.style === "chime"}
              onChange={() => setStyle("chime")}
              data-testid="visit-request-sound-style-chime"
            />
            Chime only
          </label>
        </fieldset>
        <label className="grid gap-1 text-sm">
          <span>Volume ({Math.round(prefs.volume * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(prefs.volume * 100)}
            disabled={!prefs.enabled}
            onChange={(e) => setPrefs({ ...prefs, volume: Number(e.target.value) / 100 })}
            data-testid="visit-request-sound-volume"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Duration (seconds)</span>
          <input
            type="number"
            min={VISIT_REQUEST_ALARM_MIN_DURATION_SEC}
            max={VISIT_REQUEST_ALARM_MAX_DURATION_SEC}
            step={1}
            value={duration}
            disabled={!prefs.enabled}
            onChange={(e) => setDuration(e.target.value)}
            onBlur={() => setPrefs({ ...prefs, durationSec: clampVisitRequestAlertDurationSec(Number(duration)) })}
            className="flex h-10 w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
            data-testid="visit-request-sound-duration"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!prefs.enabled || testing !== null}
            data-testid="visit-request-test-sound"
            onClick={() => test("visit")}
          >
            {testing === "visit" ? "Playing…" : "Test visit request"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!prefs.enabled || testing !== null}
            data-testid="visit-request-test-assessment-sound"
            onClick={() => test("assessment")}
          >
            {testing === "assessment" ? "Playing…" : "Test assessment booking"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
