import { format } from "date-fns";
import * as XLSX from "xlsx";

import {
  formatAed,
  formatStatementDate,
  type GroomingPackageUsageRow,
} from "@/lib/groomingPackageStatement";

export type GroomingPackageStatement = {
  petName: string;
  ownerName: string;
  packageName: string;
  status: string;
  purchaseDate: string | null;
  expiryDate: string | null;
  pricePaid: string;
  invoiceNumber: string | null;
  sessionsUsed: number;
  sessionsTotal: number;
  sessionsLeft: number;
  usage: GroomingPackageUsageRow[];
  complimentary: {
    total: number;
    used: number;
    remaining: number;
    dates: { date: string; petName: string; loggedBy: string }[];
  } | null;
  upcoming: GroomingPackageUsageRow[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function usageCells(row: GroomingPackageUsageRow): string[] {
  return [
    formatStatementDate(row.date),
    row.petName,
    row.service,
    row.groomer,
    row.station,
    row.appointmentStatus,
    row.invoiceNumber ?? "—",
    row.usedBy,
  ];
}

const USAGE_HEADERS = [
  "Date",
  "Pet",
  "Service",
  "Groomer",
  "Station",
  "Appointment status",
  "Invoice",
  "Used by",
];

function statementTitle(statement: GroomingPackageStatement): string {
  return `${statement.petName} — ${statement.packageName}`;
}

export function printGroomingPackageStatement(statement: GroomingPackageStatement): void {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new Error("Allow pop-ups to print this package statement.");
  }
  const usageRows = statement.usage
    .map(
      (row) =>
        `<tr>${usageCells(row)
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const upcomingRows = statement.upcoming
    .map(
      (row) =>
        `<tr>${usageCells(row)
          .map((cell) => `<td>${escapeHtml(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const daycareRows = (statement.complimentary?.dates ?? [])
    .map(
      (day) =>
        `<tr><td>${escapeHtml(formatStatementDate(day.date))}</td><td>${escapeHtml(day.petName)}</td><td>${escapeHtml(day.loggedBy)}</td></tr>`,
    )
    .join("");
  const complimentary = statement.complimentary
    ? `<h2>Complimentary daycare</h2><p>${statement.complimentary.used} used / ${statement.complimentary.total} total / ${statement.complimentary.remaining} remaining</p>
       <table><thead><tr><th>Date</th><th>Pet</th><th>Logged by</th></tr></thead><tbody>${daycareRows || `<tr><td colspan="3">No daycare dates linked.</td></tr>`}</tbody></table>`
    : "";

  popup.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(statementTitle(statement))}</title>
<style>
  body { font-family: sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin-top: 24px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  dl { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; font-size: 13px; }
  dt { color: #555; }
</style></head><body>
<h1>${escapeHtml(statementTitle(statement))}</h1>
<p>${escapeHtml(statement.ownerName)} · ${escapeHtml(statement.status)}</p>
<dl>
  <dt>Purchased</dt><dd>${escapeHtml(formatStatementDate(statement.purchaseDate))}</dd>
  <dt>Expires</dt><dd>${escapeHtml(formatStatementDate(statement.expiryDate))}</dd>
  <dt>Price paid</dt><dd>${escapeHtml(statement.pricePaid)}</dd>
  <dt>Invoice</dt><dd>${escapeHtml(statement.invoiceNumber ?? "—")}</dd>
  <dt>Sessions</dt><dd>${statement.sessionsUsed} / ${statement.sessionsTotal} · ${statement.sessionsLeft} left</dd>
</dl>
<h2>Usage history</h2>
<table><thead><tr>${USAGE_HEADERS.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
<tbody>${usageRows || `<tr><td colspan="${USAGE_HEADERS.length}">No linked visits.</td></tr>`}</tbody></table>
${complimentary}
<h2>Upcoming</h2>
<table><thead><tr>${USAGE_HEADERS.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
<tbody>${upcomingRows || `<tr><td colspan="${USAGE_HEADERS.length}">No upcoming appointments.</td></tr>`}</tbody></table>
</body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export function exportGroomingPackageStatement(statement: GroomingPackageStatement): void {
  const summary = XLSX.utils.aoa_to_sheet([
    ["Pet", statement.petName],
    ["Owner", statement.ownerName],
    ["Package", statement.packageName],
    ["Status", statement.status],
    ["Purchased", formatStatementDate(statement.purchaseDate)],
    ["Expires", formatStatementDate(statement.expiryDate)],
    ["Price paid", statement.pricePaid],
    ["Invoice", statement.invoiceNumber ?? ""],
    ["Sessions used", statement.sessionsUsed],
    ["Sessions total", statement.sessionsTotal],
    ["Sessions left", statement.sessionsLeft],
    [
      "Complimentary daycare",
      statement.complimentary
        ? `${statement.complimentary.used} / ${statement.complimentary.total} (${statement.complimentary.remaining} left)`
        : "",
    ],
  ]);
  const usage = XLSX.utils.aoa_to_sheet([
    USAGE_HEADERS,
    ...statement.usage.map((row) => usageCells(row)),
  ]);
  const daycare = XLSX.utils.aoa_to_sheet([
    ["Date", "Pet", "Logged by"],
    ...(statement.complimentary?.dates ?? []).map((day) => [
      formatStatementDate(day.date),
      day.petName,
      day.loggedBy,
    ]),
  ]);
  const upcoming = XLSX.utils.aoa_to_sheet([
    USAGE_HEADERS,
    ...statement.upcoming.map((row) => usageCells(row)),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, summary, "Summary");
  XLSX.utils.book_append_sheet(book, usage, "Usage");
  XLSX.utils.book_append_sheet(book, daycare, "Daycare");
  XLSX.utils.book_append_sheet(book, upcoming, "Upcoming");
  const safePet = statement.petName.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "package";
  XLSX.writeFile(book, `package-statement-${safePet}-${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}
