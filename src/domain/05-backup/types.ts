import type { Collection, CollectionId, Revision, Snippet } from "../01-library/types";

export const ARCHIVE_FORMAT = "snippet-desk";
export const ARCHIVE_VERSION = 1;
/** A sanity limit on one import: far above a real library, low enough to refuse a wrong file quickly. */
export const MAX_ARCHIVE_SNIPPETS = 5000;
/** Automatic and manual backups kept; older ones are removed. */
export const MAX_BACKUPS = 10;

/** The whole library as one JSON file — what export writes and import reads. */
export interface LibraryArchive {
  format: typeof ARCHIVE_FORMAT;
  version: typeof ARCHIVE_VERSION;
  exportedAt: string;
  snippets: Snippet[];
  revisions: Revision[];
  collections: Collection[];
}

export interface LibrarySnapshot {
  snippets: Snippet[];
  revisions: Revision[];
  collections: Collection[];
}

/**
 * What happens to one snippet of the archive:
 * - `added` — not in the library yet;
 * - `updated` — same snippet, edited later in the archive than here (the local code is kept as a revision);
 * - `kept` — same snippet, but the local copy is as new or newer: left alone;
 * - `duplicate` — a different id with the same title, language and code: not added twice.
 */
export type ImportAction = "added" | "updated" | "kept" | "duplicate";

export interface ImportEntry {
  action: ImportAction;
  /** The snippet as it will be saved — ids of collections already mapped onto the library's own. */
  snippet: Snippet;
}

/** A dry run of an import, shown before anything is written; cancelling it changes nothing. */
export interface ImportPlan {
  entries: ImportEntry[];
  /** Collections the archive has and the library does not, created on apply. */
  newCollections: Collection[];
  /** Revisions of added snippets, carried over with them. */
  revisions: Revision[];
  counts: Record<ImportAction, number>;
}

/** Archive collection id → library collection id, for collections matched by name. */
export type CollectionMapping = Map<CollectionId, CollectionId>;

export interface BackupInfo {
  name: string;
  createdAt: string;
  /** Why it was made: `manual`, or `before-import` / `before-restore` when the app made it itself. */
  reason: "manual" | "before-import" | "before-restore";
}
