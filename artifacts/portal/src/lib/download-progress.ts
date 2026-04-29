import type { StreamDownloadProgress } from "./admin-panel-api";

/**
 * Render a transient "Downloading… N rows · K KB" hint while a streamed
 * export is being pulled down. Shared by the audit-log, communications-log,
 * and members export pages so they all read the same to admins regardless of
 * which page they're on.
 *
 * `rowsReceived` is shown only for CSV exports (where we approximate it from
 * newline counts during the stream). JSON exports leave it null and we just
 * surface the byte counter, since counting top-level commas across chunk
 * boundaries is too brittle to be useful as a hint.
 */
export function formatDownloadProgress(progress: StreamDownloadProgress): string {
  const rows =
    progress.rowsReceived != null && progress.rowsReceived > 0
      ? `${progress.rowsReceived.toLocaleString()} rows · `
      : "";
  return `Downloading… ${rows}${formatBytes(progress.bytesReceived)}`;
}

/**
 * Human-readable size formatter for the in-flight progress hint. We don't
 * need TB precision — admin exports cap out well under that.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
