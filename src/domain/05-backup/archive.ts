import { err, ok, type Result } from "../01-library/errors";
import type { Collection, Revision, Snippet } from "../01-library/types";
import { normalizeTag } from "../03-organize/organize";
import { MAX_COLLECTION_NAME_LENGTH, MAX_TAGS_PER_SNIPPET } from "../03-organize/types";
import { archiveError, type ArchiveError } from "./errors";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  MAX_ARCHIVE_SNIPPETS,
  type CollectionMapping,
  type ImportAction,
  type ImportEntry,
  type ImportPlan,
  type LibraryArchive,
  type LibrarySnapshot,
} from "./types";

/** The library as an archive. Snippets oldest first so a diff of two exports reads naturally. */
export function buildArchive(library: LibrarySnapshot, exportedAt: string): LibraryArchive {
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt,
    snippets: [...library.snippets].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    revisions: [...library.revisions],
    collections: [...library.collections],
  };
}

export function serializeArchive(archive: LibraryArchive): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

/** `snippet-desk-2026-09-27.json` — the name the save dialog suggests. */
export function exportFileName(exportedAt: string): string {
  return `snippet-desk-${exportedAt.slice(0, 10)}.json`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const filled = (value: unknown): value is string => text(value) && value.trim() !== "";

function readSnippet(raw: unknown, index: number): Result<Snippet, ArchiveError> {
  if (!isRecord(raw)) return err(archiveError("invalid-snippet", index));
  for (const field of ["id", "title", "language"] as const) {
    if (!filled(raw[field])) return err(archiveError("invalid-snippet", index, field));
  }
  // Code is kept exactly as written, so only emptiness is refused, not whitespace.
  if (!text(raw.code) || raw.code === "") return err(archiveError("invalid-snippet", index, "code"));
  if (!Array.isArray(raw.tagIds) || raw.tagIds.length > MAX_TAGS_PER_SNIPPET) {
    return err(archiveError("invalid-snippet", index, "tagIds"));
  }
  const tags: string[] = [];
  for (const piece of raw.tagIds) {
    const tag = text(piece) ? normalizeTag(piece) : null;
    if (!tag?.ok) return err(archiveError("invalid-snippet", index, "tagIds"));
    if (!tags.includes(tag.value)) tags.push(tag.value);
  }
  if (raw.collectionId !== null && raw.collectionId !== undefined && !filled(raw.collectionId)) {
    return err(archiveError("invalid-snippet", index, "collectionId"));
  }
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (!filled(raw[field]) || Number.isNaN(Date.parse(raw[field]))) return err(archiveError("invalid-snippet", index, field));
  }
  return ok({
    id: raw.id as string,
    title: (raw.title as string).trim(),
    code: raw.code,
    language: (raw.language as string).trim(),
    tagIds: tags,
    collectionId: (raw.collectionId as string | null | undefined) ?? null,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  });
}

/**
 * Reads an archive file, refusing anything that is not one: not JSON, JSON of another shape, a newer
 * format version, or a record with a missing or wrong field (the first one is named). Tags are
 * normalised the way the library stores them.
 */
export function parseArchive(input: string): Result<LibraryArchive, ArchiveError> {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return err(archiveError("not-json"));
  }
  if (!isRecord(raw) || raw.format !== ARCHIVE_FORMAT || !Array.isArray(raw.snippets)) {
    return err(archiveError("not-an-archive"));
  }
  if (raw.version !== ARCHIVE_VERSION) return err(archiveError("unsupported-version"));
  if (raw.snippets.length > MAX_ARCHIVE_SNIPPETS) return err(archiveError("too-many-snippets"));

  const snippets: Snippet[] = [];
  for (const [index, entry] of raw.snippets.entries()) {
    const snippet = readSnippet(entry, index);
    if (!snippet.ok) return snippet;
    snippets.push(snippet.value);
  }

  const collections: Collection[] = [];
  for (const [index, entry] of (Array.isArray(raw.collections) ? raw.collections : []).entries()) {
    if (!isRecord(entry) || !filled(entry.id) || !filled(entry.name) || entry.name.trim().length > MAX_COLLECTION_NAME_LENGTH) {
      return err(archiveError("invalid-collection", index));
    }
    collections.push({ id: entry.id, name: entry.name.trim().replace(/\s+/g, " ") });
  }

  const revisions: Revision[] = [];
  for (const [index, entry] of (Array.isArray(raw.revisions) ? raw.revisions : []).entries()) {
    if (!isRecord(entry) || !filled(entry.id) || !filled(entry.snippetId) || !text(entry.code) || !text(entry.note) || !filled(entry.createdAt)) {
      return err(archiveError("invalid-revision", index));
    }
    revisions.push({ id: entry.id, snippetId: entry.snippetId, code: entry.code, note: entry.note, createdAt: entry.createdAt });
  }

  return ok({
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: filled(raw.exportedAt) ? raw.exportedAt : "",
    snippets,
    revisions,
    collections,
  });
}

const sameContent = (a: Snippet, b: Snippet) => a.title === b.title && a.language === b.language && a.code === b.code;

/**
 * Matches archive collections onto the library's by name, ignoring case; the rest become new
 * collections, keeping their archive id unless the library already uses it.
 */
export function mapCollections(
  library: readonly Collection[],
  archive: readonly Collection[],
  newId: () => string,
): { mapping: CollectionMapping; created: Collection[] } {
  const mapping: CollectionMapping = new Map();
  const created: Collection[] = [];
  const known = [...library];
  for (const collection of archive) {
    const match = known.find((c) => c.name.toLocaleLowerCase() === collection.name.toLocaleLowerCase());
    if (match) {
      mapping.set(collection.id, match.id);
      continue;
    }
    const id = known.some((c) => c.id === collection.id) ? newId() : collection.id;
    const fresh = { id, name: collection.name };
    known.push(fresh);
    created.push(fresh);
    mapping.set(collection.id, id);
  }
  return { mapping, created };
}

/**
 * The dry run of importing `archive` into `library`: what is added, updated, kept or skipped as a
 * duplicate. Pure — applying it is the backend's job, after a backup, and cancelling it costs nothing.
 */
export function planImport(
  library: LibrarySnapshot,
  archive: LibraryArchive,
  newId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  const { mapping, created } = mapCollections(library.collections, archive.collections, newId);
  const byId = new Map(library.snippets.map((snippet) => [snippet.id, snippet]));
  const seen: Snippet[] = [...library.snippets];
  const entries: ImportEntry[] = [];

  for (const incoming of archive.snippets) {
    const collectionId = incoming.collectionId === null ? null : (mapping.get(incoming.collectionId) ?? null);
    const snippet = { ...incoming, collectionId };
    const local = byId.get(incoming.id);
    let action: ImportAction;
    if (local) {
      action = incoming.updatedAt > local.updatedAt && !sameContent(local, snippet) ? "updated" : "kept";
    } else if (seen.some((other) => sameContent(other, snippet))) {
      action = "duplicate";
    } else {
      action = "added";
      seen.push(snippet);
    }
    entries.push({ action, snippet });
  }

  const added = new Set(entries.filter((entry) => entry.action === "added").map((entry) => entry.snippet.id));
  const counts: Record<ImportAction, number> = { added: 0, updated: 0, kept: 0, duplicate: 0 };
  for (const entry of entries) counts[entry.action] += 1;

  return {
    entries,
    newCollections: created,
    revisions: archive.revisions.filter((revision) => added.has(revision.snippetId)),
    counts,
  };
}

/** `snippet-desk-2026-09-27T10-30-00Z-before-import.sqlite3`: sortable, and says why it exists. */
export function backupName(createdAt: string, reason: "manual" | "before-import" | "before-restore"): string {
  const stamp = createdAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  return `snippet-desk-${stamp}-${reason}.sqlite3`;
}
