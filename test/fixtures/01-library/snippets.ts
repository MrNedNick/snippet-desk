import type { Snippet } from "../../../src/domain/01-library/types";

export const fixedNow = "2026-09-13T12:00:00.000Z";

export const sampleSnippets: Snippet[] = [
  {
    id: "snippet-1",
    title: "Debounce a function",
    code: "function debounce(fn, wait) { /* ... */ }",
    language: "typescript",
    tagIds: ["tag-utils"],
    collectionId: "collection-web",
    createdAt: fixedNow,
    updatedAt: fixedNow,
  },
  {
    id: "snippet-2",
    title: "SQLite FTS5 virtual table",
    code: "CREATE VIRTUAL TABLE snippets_fts USING fts5(title, code);",
    language: "sql",
    tagIds: ["tag-sql"],
    collectionId: "collection-desktop",
    createdAt: fixedNow,
    updatedAt: fixedNow,
  },
];
