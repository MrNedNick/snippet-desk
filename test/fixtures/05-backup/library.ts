import type { Collection, Revision, Snippet } from "../../../src/domain/01-library/types";
import type { LibrarySnapshot } from "../../../src/domain/05-backup";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;

const snippet = (id: string, title: string, code: string, day: number, extra: Partial<Snippet> = {}): Snippet => ({
  id,
  title,
  code,
  language: "typescript",
  tagIds: [],
  collectionId: null,
  createdAt: at(1),
  updatedAt: at(day),
  ...extra,
});

export const libraryCollections: Collection[] = [{ id: "col-local-react", name: "React" }];

/** The library the archive is imported into. */
export const library: LibrarySnapshot = {
  snippets: [
    snippet("debounce", "useDebounce", "export function useDebounce() {}", 10, { collectionId: "col-local-react", tagIds: ["react"] }),
    snippet("retry", "Retry", "fn retry() {}", 12, { language: "rust" }),
    snippet("local-only", "Local only", "// not in the archive", 5),
  ],
  revisions: [],
  collections: libraryCollections,
};

const archiveRevisions: Revision[] = [
  { id: "rev-1", snippetId: "fetch", code: "fetch(url)", note: "first try", createdAt: at(3) },
  { id: "rev-2", snippetId: "retry", code: "old retry", note: "", createdAt: at(2) },
];

/** An export from another machine, covering every import action. */
export const archiveJson = JSON.stringify({
  format: "snippet-desk",
  version: 1,
  exportedAt: at(20),
  collections: [
    { id: "col-remote-react", name: "react" },
    { id: "col-local-react", name: "SQL recipes" },
  ],
  snippets: [
    // Same id, edited later on the other machine: updated.
    snippet("debounce", "useDebounce", "export function useDebounce(wait = 200) {}", 15, { collectionId: "col-remote-react", tagIds: ["React", "hooks"] }),
    // Same id, older than here: kept.
    snippet("retry", "Retry", "fn retry_old() {}", 8, { language: "rust" }),
    // New: added, with its revision, into a collection matched by name.
    snippet("fetch", "Fetch with retry", "await fetch(url)", 14, { collectionId: "col-remote-react" }),
    // A different id with the same title, language and code as a local snippet: duplicate.
    snippet("local-only-copy", "Local only", "// not in the archive", 6),
    // New, in a collection the library does not have — whose archive id clashes with a local one.
    snippet("fts", "FTS query", "SELECT * FROM snippets_fts", 13, { language: "sql", collectionId: "col-local-react" }),
  ],
  revisions: archiveRevisions,
});

/** Files people pick by mistake, and the reason each is refused. */
export const badArchives: ReadonlyArray<readonly [label: string, input: string, reason: string, index?: number, field?: string]> = [
  ["not JSON", "{ snippets: [", "not-json"],
  ["someone else's JSON", JSON.stringify({ name: "package", version: "1.0.0" }), "not-an-archive"],
  ["a bare list", JSON.stringify([]), "not-an-archive"],
  ["a newer format", JSON.stringify({ format: "snippet-desk", version: 2, snippets: [] }), "unsupported-version"],
  [
    "a snippet without code",
    JSON.stringify({ format: "snippet-desk", version: 1, snippets: [snippet("x", "X", "", 1)] }),
    "invalid-snippet",
    0,
    "code",
  ],
  [
    "a snippet with a date that is not one",
    JSON.stringify({ format: "snippet-desk", version: 1, snippets: [snippet("x", "X", "x", 1), { ...snippet("y", "Y", "y", 1), updatedAt: "yesterday" }] }),
    "invalid-snippet",
    1,
    "updatedAt",
  ],
  [
    "a tag that normalises to nothing",
    JSON.stringify({ format: "snippet-desk", version: 1, snippets: [snippet("x", "X", "x", 1, { tagIds: ["!!!"] })] }),
    "invalid-snippet",
    0,
    "tagIds",
  ],
  [
    "a nameless collection",
    JSON.stringify({ format: "snippet-desk", version: 1, snippets: [], collections: [{ id: "c", name: "  " }] }),
    "invalid-collection",
    0,
  ],
];
