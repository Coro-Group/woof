import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import TopBar from "@/components/dashboard/TopBar";
import { ReferenceListsSettings } from "@/components/settings/ReferenceListsSettings";
import { ComplimentaryDaycareSettings } from "@/components/settings/ComplimentaryDaycareSettings";
import VisitRequestSoundSettings from "@/components/settings/VisitRequestSoundSettings";
import { supabase } from "@/integrations/supabase/client";

type SaveResult = "idle" | "success" | "error";
type ContextKey = "business_rules" | "query_guidelines" | "write_guidelines";

type SystemContextRow = {
  key: ContextKey;
  content: string | null;
  updated_at: string | null;
};

type SystemContextRowWithoutUpdatedAt = {
  key: ContextKey;
  content: string | null;
};

const SettingsPage = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rulesContent, setRulesContent] = useState<string>("");
  const [originalRules, setOriginalRules] = useState<string>("");
  const [queryGuidelines, setQueryGuidelines] = useState<string | null>(null);
  const [writeGuidelines, setWriteGuidelines] = useState<string | null>(null);
  const [rulesUpdatedAt, setRulesUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveResult, setSaveResult] = useState<SaveResult>("idle");
  const successTimeoutRef = useRef<number | null>(null);

  const isDirty = useMemo(() => rulesContent !== originalRules, [rulesContent, originalRules]);

  useEffect(() => {
    const loadContextRows = async () => {
      setLoading(true);
      setLoadError(null);

      let contextRows: SystemContextRow[] = [];

      const { data, error } = await supabase
        .from("system_context")
        .select("key, content, updated_at")
        .in("key", ["business_rules", "query_guidelines", "write_guidelines"]);

      if (error) {
        const isMissingUpdatedAtColumn =
          error.code === "42703" || error.message.toLowerCase().includes("updated_at");

        if (!isMissingUpdatedAtColumn) {
          setLoadError(error.message);
          setLoading(false);
          return;
        }

        const fallback = await supabase
          .from("system_context")
          .select("key, content")
          .in("key", ["business_rules", "query_guidelines", "write_guidelines"]);

        if (fallback.error) {
          setLoadError(fallback.error.message);
          setLoading(false);
          return;
        }

        contextRows = ((fallback.data ?? []) as SystemContextRowWithoutUpdatedAt[]).map((row) => ({
          ...row,
          updated_at: null,
        }));
      } else {
        contextRows = (data ?? []) as SystemContextRow[];
      }

      const rows = contextRows.reduce<Record<ContextKey, SystemContextRow | null>>(
        (acc, row) => {
          acc[row.key] = row;
          return acc;
        },
        {
          business_rules: null,
          query_guidelines: null,
          write_guidelines: null,
        },
      );

      const businessRules = rows.business_rules?.content ?? "";
      setRulesContent(businessRules);
      setOriginalRules(businessRules);
      setRulesUpdatedAt(rows.business_rules?.updated_at ?? null);
      setQueryGuidelines(rows.query_guidelines?.content ?? "");
      setWriteGuidelines(rows.write_guidelines?.content ?? "");
      setLoading(false);
    };

    void loadContextRows();

    return () => {
      if (successTimeoutRef.current !== null) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);

    const { error } = await supabase
      .from("system_context")
      .update({ content: rulesContent })
      .eq("key", "business_rules");

    if (error) {
      setSaveResult("error");
      setSaving(false);
      return;
    }

    setOriginalRules(rulesContent);
    setSaveResult("success");
    setRulesUpdatedAt(new Date().toISOString());
    if (successTimeoutRef.current !== null) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => setSaveResult("idle"), 3000);
    setSaving(false);
  };

  const formattedUpdatedAt = useMemo(() => {
    if (!rulesUpdatedAt) return null;
    return new Date(rulesUpdatedAt).toLocaleString("en-AE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [rulesUpdatedAt]);

  return (
    <>
      <TopBar title="Settings" />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-8">
          {loadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not load system context</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          <ReferenceListsSettings />
          <ComplimentaryDaycareSettings />
          <VisitRequestSoundSettings />

          {loading ? (
            <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-72 w-full" />
                <Skeleton className="h-9 w-28 self-end" />
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-56 w-full" />
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-56 w-full" />
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Business rules</h2>
                <p className="text-sm text-muted-foreground">
                  Controls how the AI understands woof pricing, seasons, membership tiers, and service rules.
                  Changes take effect immediately on the next conversation.
                </p>
                {formattedUpdatedAt && (
                  <p className="text-xs text-muted-foreground">Last updated: {formattedUpdatedAt}</p>
                )}
                <Textarea
                  value={rulesContent}
                  onChange={(e) => {
                    setRulesContent(e.target.value);
                    setSaveResult("idle");
                  }}
                  rows={20}
                  className="font-mono text-sm w-full overflow-y-auto"
                  placeholder="Business rules content..."
                />
                <div className="flex items-center justify-between gap-3">
                  <div>
                    {isDirty && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Unsaved changes
                      </span>
                    )}
                  </div>
                  <Button type="button" onClick={() => void handleSave()} disabled={!isDirty || saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
                {saveResult === "success" && (
                  <p className="text-sm text-emerald-600">
                    Saved. The AI will use the updated rules on the next conversation.
                  </p>
                )}
                {saveResult === "error" && (
                  <p className="text-sm text-destructive">Save failed. Please try again.</p>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Query guidelines</h2>
                <p className="text-sm text-muted-foreground">
                  Controls how the AI queries the database. Read-only — contact your developer to change these.
                </p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-4 font-mono text-sm">
                  {queryGuidelines === null ? "Loading..." : queryGuidelines}
                </pre>
              </div>

              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Write guidelines</h2>
                <p className="text-sm text-muted-foreground">
                  Safety rules the AI follows before taking any action. Read-only — contact your developer to
                  change these.
                </p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-4 font-mono text-sm">
                  {writeGuidelines === null ? "Loading..." : writeGuidelines}
                </pre>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
};

export default SettingsPage;
