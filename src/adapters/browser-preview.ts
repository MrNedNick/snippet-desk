import { isTauri, type InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Revision, Snippet } from "../domain/01-library/types";

const KEY = "snippet-desk:browser-preview";

interface PreviewData {
  snippets: Snippet[];
  revisions: Revision[];
}

const SEED: PreviewData = {
  snippets: [
    {
      id: "seed-debounce",
      title: "Debounce a function",
      code: "export function debounce<T extends unknown[]>(fn: (...args: T) => void, wait = 200) {\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (...args: T) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}\n",
      language: "typescript",
      tagIds: [],
      collectionId: null,
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
    {
      id: "seed-fts",
      title: "Full-text search in SQLite",
      code: "-- one FTS5 row per snippet; quote user terms so OR / - stay text\nSELECT s.id, s.title\nFROM snippets s\nJOIN snippets_fts f ON f.id = s.id\nWHERE snippets_fts MATCH '\"debounce\"'\nORDER BY rank;\n",
      language: "sql",
      tagIds: [],
      collectionId: null,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    },
    {
      id: "seed-retry",
      title: "Retry with backoff",
      code: "fn retry<T, E>(mut attempt: impl FnMut() -> Result<T, E>, times: u32) -> Result<T, E> {\n    let mut last = attempt();\n    for n in 1..times {\n        if last.is_ok() { break; }\n        std::thread::sleep(std::time::Duration::from_millis(100 * 2u64.pow(n)));\n        last = attempt();\n    }\n    last\n}\n",
      language: "rust",
      tagIds: [],
      collectionId: null,
      createdAt: "2026-09-01T07:00:00.000Z",
      updatedAt: "2026-09-01T07:00:00.000Z",
    },
  ],
  revisions: [],
};

function load(storage: Storage): PreviewData {
  try {
    const raw = storage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PreviewData;
  } catch {
    // Unreadable preview data: start again from the examples.
  }
  return structuredClone(SEED);
}

type Args = Record<string, unknown>;

/** The same validation and reasons as `src-tauri/src/commands.rs`, so the UI behaves identically. */
function validate(input: { title: string; code: string; language: string }): string | null {
  if (!input.title.trim()) return "title-empty";
  if (!input.code) return "code-empty";
  if (!input.language.trim()) return "language-empty";
  return null;
}

/**
 * Handles the app's commands in the browser when there is no desktop shell: the page served by
 * `npm run dev` (or a static build) stays usable, with snippets kept in this browser's storage instead
 * of the app's SQLite file. The command names, arguments and failure reasons are the desktop ones.
 */
export function previewCommands(storage: Storage, now: () => string = () => new Date().toISOString()) {
  let data = load(storage);
  const save = () => storage.setItem(KEY, JSON.stringify(data));
  const byNewest = (list: Snippet[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (cmd: string, payload?: InvokeArgs): unknown => {
    const args = (payload ?? {}) as Args;
    switch (cmd) {
      case "list_snippets":
        return byNewest(data.snippets);
      case "search_snippets": {
        const terms = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) throw "query-empty";
        return byNewest(data.snippets).filter((s) => {
          const text = `${s.title} ${s.code} ${s.language}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        });
      }
      case "create_snippet": {
        const input = args.input as { title: string; code: string; language: string };
        const reason = validate(input);
        if (reason) throw reason;
        const at = now();
        const snippet: Snippet = {
          id: crypto.randomUUID(),
          title: input.title.trim(),
          code: input.code,
          language: input.language.trim(),
          tagIds: [],
          collectionId: null,
          createdAt: at,
          updatedAt: at,
        };
        data = { ...data, snippets: [...data.snippets, snippet] };
        save();
        return snippet;
      }
      case "update_snippet": {
        const input = args.input as { id: string; title: string; code: string; language: string; note: string };
        const reason = validate(input);
        if (reason) throw reason;
        const current = data.snippets.find((s) => s.id === input.id);
        if (!current) throw "snippet-not-found";
        const at = now();
        const revisions =
          current.code === input.code
            ? data.revisions
            : [...data.revisions, { id: crypto.randomUUID(), snippetId: current.id, code: current.code, note: input.note.trim(), createdAt: at }];
        const updated: Snippet = { ...current, title: input.title.trim(), code: input.code, language: input.language.trim(), updatedAt: at };
        data = { snippets: data.snippets.map((s) => (s.id === updated.id ? updated : s)), revisions };
        save();
        return updated;
      }
      case "list_revisions":
        return data.revisions.filter((r) => r.snippetId === args.snippetId).reverse();
      default:
        throw `unknown command ${cmd}`;
    }
  };
}

/** Installs the browser preview when the page is not running inside the desktop app. */
export function installBrowserPreview(storage: Storage): boolean {
  if (isTauri()) return false;
  mockIPC(previewCommands(storage));
  return true;
}
