import { isTauri, type InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { Collection, Revision, Snippet } from "../domain/01-library/types";
import { normalizeTag, validateCollectionName } from "../domain/03-organize/organize";
import { MAX_TAGS_PER_SNIPPET } from "../domain/03-organize/types";
import { DEFAULT_SHORTCUT, MAX_RECENT, parseShortcut, recordUse, type UsageEntry } from "../domain/04-quick";
import { backupName, buildArchive, MAX_BACKUPS, parseArchive, planImport, serializeArchive, type BackupInfo, type ImportPlan } from "../domain/05-backup";

const KEY = "snippet-desk:browser-preview";
/** The version in `package.json` and `tauri.conf.json`, which move together. */
const PREVIEW_VERSION = "0.1.0";

interface PreviewData {
  snippets: Snippet[];
  revisions: Revision[];
  collections: Collection[];
  recent: UsageEntry[];
  shortcut: string;
}

const SEED: PreviewData = {
  snippets: [
    {
      id: "seed-debounce",
      title: "Debounce a function",
      code: "export function debounce<T extends unknown[]>(fn: (...args: T) => void, wait = 200) {\n  let timer: ReturnType<typeof setTimeout> | undefined;\n  return (...args: T) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}\n",
      language: "typescript",
      tagIds: ["typescript", "timing"],
      collectionId: "seed-frontend",
      createdAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
    {
      id: "seed-fts",
      title: "Full-text search in SQLite",
      code: "-- one FTS5 row per snippet; quote user terms so OR / - stay text\nSELECT s.id, s.title\nFROM snippets s\nJOIN snippets_fts f ON f.id = s.id\nWHERE snippets_fts MATCH '\"debounce\"'\nORDER BY rank;\n",
      language: "sql",
      tagIds: ["sqlite", "search"],
      collectionId: null,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    },
    {
      id: "seed-retry",
      title: "Retry with backoff",
      code: "fn retry<T, E>(mut attempt: impl FnMut() -> Result<T, E>, times: u32) -> Result<T, E> {\n    let mut last = attempt();\n    for n in 1..times {\n        if last.is_ok() { break; }\n        std::thread::sleep(std::time::Duration::from_millis(100 * 2u64.pow(n)));\n        last = attempt();\n    }\n    last\n}\n",
      language: "rust",
      tagIds: ["rust", "timing"],
      collectionId: null,
      createdAt: "2026-09-01T07:00:00.000Z",
      updatedAt: "2026-09-01T07:00:00.000Z",
    },
  ],
  revisions: [],
  collections: [{ id: "seed-frontend", name: "Frontend" }],
  recent: [],
  shortcut: DEFAULT_SHORTCUT,
};

/**
 * The browser's copy of the library. Data that can't be read is the preview's version of a damaged
 * database file: it is kept as it is — not silently replaced by the examples, which the next save would
 * then write over it — and every command reports `database-corrupted` until the user sets it aside.
 */
function load(storage: Storage): { data: PreviewData; damage: string | null } {
  const raw = storage.getItem(KEY);
  if (!raw) return { data: structuredClone(SEED), damage: null };
  try {
    const data = JSON.parse(raw) as Partial<PreviewData>;
    if (!data || typeof data !== "object" || !Array.isArray(data.snippets)) throw new Error("no snippet list");
    // Data saved before collections, recent uses or the shortcut existed simply has none yet.
    return {
      data: {
        snippets: data.snippets,
        revisions: data.revisions ?? [],
        collections: data.collections ?? [],
        recent: data.recent ?? [],
        shortcut: data.shortcut ?? DEFAULT_SHORTCUT,
      },
      damage: null,
    };
  } catch (cause) {
    return { data: structuredClone(SEED), damage: `preview data is unreadable (${cause instanceof Error ? cause.message : String(cause)})` };
  }
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
  const loaded = load(storage);
  let data = loaded.data;
  let damage = loaded.damage;
  const save = () => storage.setItem(KEY, JSON.stringify(data));
  const touch = (id: string, patch: Partial<Snippet>): Snippet => {
    const current = data.snippets.find((s) => s.id === id);
    if (!current) throw "snippet-not-found";
    const updated = { ...current, ...patch, updatedAt: now() };
    data = { ...data, snippets: data.snippets.map((s) => (s.id === id ? updated : s)) };
    save();
    return updated;
  };
  const byNewest = (list: Snippet[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Backups are whole copies of the preview data under their own keys, named like the desktop's files.
  const BACKUP_PREFIX = `${KEY}:backup:`;
  const staged = new Map<string, ImportPlan>();
  const listBackups = (): BackupInfo[] => {
    const names: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(BACKUP_PREFIX)) names.push(key.slice(BACKUP_PREFIX.length));
    }
    return names
      .sort()
      .reverse()
      .map((name) => {
        const match = /^snippet-desk-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-(manual|before-import|before-restore)\.sqlite3$/.exec(name);
        return match
          ? { name, createdAt: `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`, reason: match[5] as BackupInfo["reason"] }
          : null;
      })
      .filter((backup): backup is BackupInfo => backup !== null);
  };
  const backup = (reason: BackupInfo["reason"]): BackupInfo => {
    let at = now();
    // Two backups in the same second would share a name; the desktop overwrites, the preview steps a second on.
    while (storage.getItem(BACKUP_PREFIX + backupName(at, reason)) !== null) at = new Date(Date.parse(at) + 1000).toISOString();
    const name = backupName(at, reason);
    storage.setItem(BACKUP_PREFIX + name, JSON.stringify(data));
    for (const old of listBackups().slice(MAX_BACKUPS)) storage.removeItem(BACKUP_PREFIX + old.name);
    return listBackups().find((entry) => entry.name === name)!;
  };

  return (cmd: string, payload?: InvokeArgs): unknown => {
    const args = (payload ?? {}) as Args;
    // Same answers as the desktop app with a damaged file: health and the way out work, nothing else.
    if (damage !== null) {
      if (cmd === "library_health") return { status: "damaged", detail: damage };
      if (cmd === "set_aside_damaged_library") {
        const kept = `${KEY}:damaged-${Date.parse(now())}`;
        storage.setItem(kept, storage.getItem(KEY) ?? "");
        data = structuredClone(SEED);
        damage = null;
        save();
        return kept;
      }
      if (cmd !== "get_quick_shortcut" && cmd !== "app_version") throw `database-corrupted: ${damage}`;
    }
    switch (cmd) {
      case "library_health":
        return { status: "ok", detail: null };
      // A web page has no installed version to update; the desktop answers these from the bundle.
      case "app_version":
        return { version: PREVIEW_VERSION, platform: "browser", updates: "not-configured" };
      case "check_for_updates":
      case "install_update":
        throw "updates-not-configured";
      // The desktop app writes the file through a save dialog; the page downloads this text instead.
      case "export_library_json":
        return serializeArchive(buildArchive(data, now()));
      // The desktop app reads the file through an open dialog; the page hands over the picked file's text.
      case "stage_import_text": {
        const archive = parseArchive(String(args.text));
        if (!archive.ok) {
          const { reason, index, field } = archive.error;
          throw [reason, index, field].filter((part) => part !== undefined).join(":");
        }
        const plan = planImport(data, archive.value);
        const token = crypto.randomUUID();
        staged.set(token, plan);
        return { status: "ready", token, plan };
      }
      case "apply_import": {
        const plan = staged.get(String(args.token));
        if (!plan) throw "import-not-found";
        staged.delete(String(args.token));
        const made = backup("before-import");
        const at = now();
        let snippets = [...data.snippets];
        let revisions = [...data.revisions];
        for (const entry of plan.entries) {
          if (entry.action === "added") snippets.push(entry.snippet);
          if (entry.action === "updated") {
            const local = snippets.find((s) => s.id === entry.snippet.id)!;
            revisions.push({ id: crypto.randomUUID(), snippetId: local.id, code: local.code, note: "Before import", createdAt: at });
            snippets = snippets.map((s) => (s.id === local.id ? entry.snippet : s));
          }
        }
        revisions = [...revisions, ...plan.revisions.filter((r) => !revisions.some((known) => known.id === r.id))];
        data = { ...data, snippets, revisions, collections: [...data.collections, ...plan.newCollections] };
        save();
        return { counts: plan.counts, backup: made };
      }
      case "cancel_import":
        staged.delete(String(args.token));
        return null;
      case "create_backup":
        return backup("manual");
      case "list_backups":
        return listBackups();
      case "restore_backup": {
        const name = String(args.name);
        const raw = listBackups().some((entry) => entry.name === name) ? storage.getItem(BACKUP_PREFIX + name) : null;
        if (raw === null) throw "backup-not-found";
        const restored = load({ getItem: () => raw } as unknown as Storage);
        if (restored.damage) throw `database-corrupted: ${restored.damage}`;
        const safety = backup("before-restore");
        data = restored.data;
        save();
        return safety;
      }
      case "set_aside_damaged_library":
        throw "database-not-damaged";
      case "list_recent_uses": {
        const ids = new Set(data.snippets.map((s) => s.id));
        return data.recent.filter((entry) => ids.has(entry.snippetId)).slice(0, MAX_RECENT);
      }
      case "record_snippet_use": {
        const id = String(args.id);
        if (!data.snippets.some((s) => s.id === id)) throw "snippet-not-found";
        data = { ...data, recent: recordUse(data.recent, id, now()) };
        save();
        return data.recent;
      }
      // A web page cannot own a system-wide shortcut; the preview says so and keeps the choice anyway.
      case "get_quick_shortcut":
        return { accelerator: data.shortcut, registered: false, error: "shortcut-unavailable: global shortcuts need the desktop app" };
      case "set_quick_shortcut": {
        const parsed = parseShortcut(String(args.accelerator));
        if (!parsed.ok) throw `shortcut-unavailable: ${parsed.error.reason}`;
        data = { ...data, shortcut: parsed.value.accelerator };
        save();
        return { accelerator: data.shortcut, registered: false, error: "shortcut-unavailable: global shortcuts need the desktop app" };
      }
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
        data = { ...data, snippets: data.snippets.map((s) => (s.id === updated.id ? updated : s)), revisions };
        save();
        return updated;
      }
      case "list_revisions":
        return data.revisions.filter((r) => r.snippetId === args.snippetId).reverse();
      case "set_snippet_tags": {
        const tags: string[] = [];
        for (const piece of args.tags as string[]) {
          const tag = normalizeTag(piece);
          if (!tag.ok) throw tag.error.reason;
          if (!tags.includes(tag.value)) tags.push(tag.value);
        }
        if (tags.length > MAX_TAGS_PER_SNIPPET) throw "too-many-tags";
        return touch(String(args.id), { tagIds: tags });
      }
      case "set_snippet_collection": {
        const collectionId = (args.collectionId as string | null) ?? null;
        if (collectionId !== null && !data.collections.some((c) => c.id === collectionId)) throw "collection-not-found";
        return touch(String(args.id), { collectionId });
      }
      case "list_collections":
        return [...data.collections].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      case "create_collection": {
        const name = validateCollectionName(String(args.name), data.collections);
        if (!name.ok) throw name.error.reason;
        const collection = { id: crypto.randomUUID(), name: name.value };
        data = { ...data, collections: [...data.collections, collection] };
        save();
        return collection;
      }
      case "rename_collection": {
        const id = String(args.id);
        if (!data.collections.some((c) => c.id === id)) throw "collection-not-found";
        const name = validateCollectionName(String(args.name), data.collections, id);
        if (!name.ok) throw name.error.reason;
        data = { ...data, collections: data.collections.map((c) => (c.id === id ? { id, name: name.value } : c)) };
        save();
        return { id, name: name.value };
      }
      case "delete_collection": {
        const id = String(args.id);
        if (!data.collections.some((c) => c.id === id)) throw "collection-not-found";
        data = {
          ...data,
          collections: data.collections.filter((c) => c.id !== id),
          snippets: data.snippets.map((s) => (s.collectionId === id ? { ...s, collectionId: null } : s)),
        };
        save();
        return null;
      }
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
