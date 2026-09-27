import type { ArchiveError, ImportAction } from "../../domain/05-backup";
import type { BackupStoreError } from "../../adapters/backup-store";

const ORDINAL = new Intl.PluralRules("en", { type: "ordinal" });
const SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
const nth = (index: number) => `${index + 1}${SUFFIX[ORDINAL.select(index + 1)]}`;

export function describeArchiveError(error: ArchiveError): string {
  switch (error.reason) {
    case "not-json":
      return "That file isn't JSON — pick a file exported from Snippet Desk.";
    case "not-an-archive":
      return "That JSON isn't a Snippet Desk export.";
    case "unsupported-version":
      return "That export comes from a newer Snippet Desk. Update the app, then import it.";
    case "too-many-snippets":
      return "That file has more snippets than one import takes (5,000).";
    case "invalid-snippet":
      return `The ${nth(error.index ?? 0)} snippet in the file has no valid ${error.field ?? "data"} — nothing was imported.`;
    case "invalid-collection":
      return `The ${nth(error.index ?? 0)} collection in the file has no name — nothing was imported.`;
    case "invalid-revision":
      return `The ${nth(error.index ?? 0)} earlier version in the file is incomplete — nothing was imported.`;
  }
}

export function describeBackupError(error: BackupStoreError): string {
  switch (error.kind) {
    case "archive":
      return describeArchiveError(error);
    case "import-expired":
      return "That import was already applied or cancelled. Pick the file again.";
    case "database-corrupted":
      return "The library file is damaged.";
    case "backend":
      return error.message === "backup-not-found" ? "That backup no longer exists." : error.message;
  }
}

export const ACTION_LABELS: Record<ImportAction, string> = {
  added: "new",
  updated: "newer in the file — replaces yours, yours is kept as an earlier version",
  kept: "yours is as new or newer — left alone",
  duplicate: "already here under another id — skipped",
};

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function describeBackup(backup: { createdAt: string; reason: string }): string {
  const when = whenFormat.format(new Date(backup.createdAt));
  const why = backup.reason === "manual" ? "" : backup.reason === "before-import" ? " · before an import" : " · before a restore";
  return `${when}${why}`;
}
