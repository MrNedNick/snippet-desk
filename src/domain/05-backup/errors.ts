export type ArchiveReason =
  | "not-json"
  | "not-an-archive"
  | "unsupported-version"
  | "too-many-snippets"
  | "invalid-snippet"
  | "invalid-collection"
  | "invalid-revision";

/** Why a file can't be imported. `index` and `field` point at the first bad record, when there is one. */
export interface ArchiveError {
  kind: "archive";
  reason: ArchiveReason;
  index?: number;
  field?: string;
}

export function archiveError(reason: ArchiveReason, index?: number, field?: string): ArchiveError {
  return { kind: "archive", reason, ...(index !== undefined ? { index } : {}), ...(field !== undefined ? { field } : {}) };
}

/** The user closed the file dialog or cancelled the preview: not an error, and nothing was written. */
export interface ImportCancelled {
  kind: "cancelled";
}

export const importCancelled: ImportCancelled = { kind: "cancelled" };
