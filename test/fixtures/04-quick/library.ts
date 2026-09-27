import type { Snippet } from "../../../src/domain/01-library/types";
import type { UsageEntry } from "../../../src/domain/04-quick";

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const base = { createdAt: at(1), collectionId: null };

export const snippets: Snippet[] = [
  { ...base, id: "debounce", title: "useDebounce", code: "export function useDebounce() {}", language: "typescript", tagIds: ["react", "hooks"], updatedAt: at(10) },
  { ...base, id: "fetch-retry", title: "Fetch with retry", code: "async function fetchWithRetry(url) {}", language: "typescript", tagIds: ["http"], updatedAt: at(12) },
  { ...base, id: "fts", title: "FTS query", code: "SELECT * FROM snippets_fts WHERE snippets_fts MATCH ?", language: "sql", tagIds: ["sqlite", "search"], updatedAt: at(5) },
  { ...base, id: "retry-rs", title: "Retry with backoff", code: "fn retry<F>(f: F) {}", language: "rust", tagIds: ["errors"], updatedAt: at(8) },
  // Special characters that must reach the clipboard untouched: tab, CRLF, emoji, a zero-width joiner and an RTL mark.
  { ...base, id: "special", title: "Special characters", code: "if (x) {\r\n\treturn \"✓ 👩‍💻\";‏\r\n}  ", language: "javascript", tagIds: [], updatedAt: at(2) },
];

export const recent: UsageEntry[] = [
  { snippetId: "fts", usedAt: at(20) },
  { snippetId: "retry-rs", usedAt: at(19) },
];

/** Accelerators people type, and the canonical form they must end up in. */
export const validShortcuts: ReadonlyArray<readonly [raw: string, accelerator: string]> = [
  ["CommandOrControl+Shift+Space", "CommandOrControl+Shift+Space"],
  ["cmdorctrl + shift + space", "CommandOrControl+Shift+Space"],
  ["Shift+Ctrl+k", "Control+Shift+K"],
  ["Alt+F12", "Alt+F12"],
  ["Option+Super+1", "Alt+Super+1"],
];

export const invalidShortcuts: ReadonlyArray<readonly [raw: string, reason: string]> = [
  ["", "shortcut-empty"],
  [" + ", "shortcut-empty"],
  ["K", "shortcut-no-modifier"],
  ["Ctrl+Shift", "shortcut-no-modifier"],
  ["Ctrl+Ctrl+K", "shortcut-duplicate-modifier"],
  ["Ctrl+Banana", "shortcut-unknown-key"],
  ["Ctrl+K+Shift", "shortcut-unknown-key"],
  ["CommandOrControl+V", "shortcut-reserved"],
  ["cmd+q", "shortcut-reserved"],
];

/** What SQLite and the Rust layer actually say about a damaged file. */
export const corruptionMessages = [
  "database-corrupted: database disk image is malformed",
  "file is not a database",
  "Error code 26: file is encrypted or is not a database",
];
