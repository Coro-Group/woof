import { TONE, type StatusTone } from "@/components/transport/status";

/** AE's StatTile: a label, a big number and a hint, as on the transport screens there. */
export function StatTile({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: number | string | undefined;
  hint?: string;
  tone?: StatusTone;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ? TONE[tone].text : ""}`}>{value ?? "—"}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
