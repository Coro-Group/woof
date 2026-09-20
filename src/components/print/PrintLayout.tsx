import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export function PrintLayout({
  children,
  imageUrls = [],
  variant = "cards",
  contentReady = true,
  contentLoadingLabel = "Loading…",
}: {
  children: React.ReactNode;
  imageUrls?: Array<string | null | undefined>;
  /** `schedule` uses A4-friendly margins and table-focused print rules (grooming daily schedule). */
  /** `map` uses landscape A4 for kennel map printouts. */
  variant?: "cards" | "schedule" | "map";
  /** When false, Print stays disabled even if images are ready (e.g. receipt still loading). */
  contentReady?: boolean;
  contentLoadingLabel?: string;
}) {
  const [imagesReady, setImagesReady] = useState(false);
  const canPrint = imagesReady && contentReady;

  const trackedImages = useMemo(() => {
    return Array.from(
      new Set(
        imageUrls
          .map((url) => (typeof url === "string" ? url.trim() : ""))
          .filter((url) => url.length > 0),
      ),
    );
  }, [imageUrls]);

  useEffect(() => {
    if (trackedImages.length === 0) {
      setImagesReady(true);
      return;
    }

    let cancelled = false;
    setImagesReady(false);

    Promise.all(
      trackedImages.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = src;
            if (img.complete) resolve();
          }),
      ),
    ).then(() => {
      if (!cancelled) setImagesReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [trackedImages]);

  return (
    <>
      <style>{`
        @media print {
          @page {
            size: ${variant === "map" ? "A4 landscape" : variant === "schedule" ? "A4" : "A5"};
            margin: ${variant === "schedule" || variant === "map" ? "12mm" : "10mm"};
          }
          html, body { margin: 0 !important; padding: 0 !important; background: white !important; color: black !important; }
          .no-print { display: none !important; }
          .print-page { page-break-after: always; break-after: page; }
          .print-page:last-child { page-break-after: auto; break-after: auto; }

          .schedule-day-section {
            page-break-before: always;
            break-before: page;
          }
          .schedule-day-section-first {
            page-break-before: auto;
            break-before: auto;
          }

          .schedule-th {
            background: #e8e8e8 !important;
            color: #111 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .schedule-data-row:nth-child(even) td {
            background: #f5f5f5 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }

        .print-root {
          color-scheme: light;
          background: #fff;
          color: #000;
          font-family: Georgia, "Times New Roman", serif;
        }

        .print-label,
        .print-sans {
          font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        }

        .print-keep-color {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .grooming-schedule-print .schedule-table {
          border: 1px solid #374151;
          width: 100%;
          table-layout: fixed;
        }
        .grooming-schedule-print .schedule-th {
          border: 1px solid #374151;
          padding: 14px 12px;
          font-weight: 700;
          font-size: 10px;
          text-transform: none;
          letter-spacing: 0.01em;
          vertical-align: bottom;
          background: #e8e8e8;
          color: #111;
        }
        .grooming-schedule-print .schedule-td {
          border: 1px solid #9ca3af;
          padding: 26px 14px;
          vertical-align: top;
          min-height: 9rem;
          font-size: 11px;
          line-height: 1.55;
          background: #fff;
        }
        .grooming-schedule-print .schedule-data-row:nth-child(even) .schedule-td {
          background: #f5f5f5;
        }
        .grooming-schedule-print .schedule-col-pet { width: 36%; }
        .grooming-schedule-print .schedule-col-date { width: 10%; }
        .grooming-schedule-print .schedule-col-groomer { width: 8%; }
        .grooming-schedule-print .schedule-col-services { width: 8%; }
        .grooming-schedule-print .schedule-col-notes { width: 38%; }
        .grooming-schedule-print .schedule-pet-lines {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          line-height: 1.55;
        }
      `}</style>

      <div className="print-root min-h-screen">
        <div className="no-print sticky top-0 z-10 border-b bg-white p-3 print-sans">
          <div
            className={`mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between ${
              variant === "schedule" || variant === "map" ? "w-full max-w-none px-4" : "max-w-[900px]"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {canPrint ? (
                <Button type="button" onClick={() => window.print()}>
                  {variant === "schedule"
                    ? "Print schedule"
                    : variant === "map"
                      ? "Print map"
                      : "Print"}
                </Button>
              ) : (
                <Button type="button" disabled>
                  {!imagesReady ? "Loading photos..." : contentLoadingLabel}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (window.history.length > 1) {
                    window.history.back();
                  } else {
                    window.close();
                  }
                }}
              >
                Back
              </Button>
            </div>
            {variant === "schedule" || variant === "map" ? (
              <p className="max-w-md text-xs text-muted-foreground">
                In the print dialog, turn off{" "}
                <span className="font-medium">Headers and footers</span> for a clean margin (browser
                setting).
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={`mx-auto p-6 print:max-w-none print:p-0 ${
            variant === "schedule" || variant === "map"
              ? "w-full max-w-none px-4 print:w-full print:px-0"
              : "max-w-[600px]"
          }`}
        >
          {children}
        </div>
      </div>
    </>
  );
}
