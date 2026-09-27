/**
 * Integration coverage for "Импорт экспорт и backup": export one library, import it into another,
 * cancel, import again, back up and restore — through the adapters and the domain together, with the
 * commands answered by the browser preview backend. The Rust side has its own copy of these scenarios
 * in `src-tauri/tests/05-backup.rs`; the save/open dialogs are replaced by the preview's download and
 * file input, the way the page itself does it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewCommands } from "../../src/adapters/browser-preview";
import { copyText } from "../../src/adapters/clipboard";
import { pastePayload, quickSearch } from "../../src/domain/04-quick";
import { MemoryStorage } from "../fixtures/memory-storage";

let storage: MemoryStorage;
let backend: ReturnType<typeof previewCommands>;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => backend(cmd, args),
  isTauri: () => false,
}));

const library = await import("../../src/adapters/snippet-store");
const quick = await import("../../src/adapters/quick-store");
const backups = await import("../../src/adapters/backup-store");

const KEY = "snippet-desk:browser-preview";

/** One browser's library; switching `backend` is switching machines. */
function machine() {
  const store = new MemoryStorage();
  return { store, backend: previewCommands(store) };
}

let laptop: ReturnType<typeof machine>;
let desktop: ReturnType<typeof machine>;
const on = (m: ReturnType<typeof machine>) => {
  storage = m.store;
  backend = m.backend;
};

beforeEach(() => {
  laptop = machine();
  desktop = machine();
  on(laptop);
});

afterEach(() => vi.unstubAllGlobals());

async function titles() {
  const listed = await library.listSnippetsRemote();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value.map((s) => s.title).sort();
}

async function exportText() {
  let text = "";
  const result = await backups.exportLibrary((_name, body) => (text = body));
  expect(result).toMatchObject({ ok: true, value: { status: "downloaded" } });
  return text;
}

async function stage(text: string | null) {
  const staged = await backups.stageImport(async () => text);
  if (!staged.ok) throw new Error(staged.error.kind === "archive" ? staged.error.reason : staged.error.kind);
  return staged.value;
}

describe("import, export and backups", () => {
  it("main path: a snippet made on one machine arrives on another, survives a restart and imports once", async () => {
    await library.createSnippetRemote({ title: "Parse CSV line", code: 'line.split(",")', language: "javascript" });
    const text = await exportText();

    on(desktop);
    const staged = await stage(text);
    expect("token" in staged && staged.plan.counts).toEqual({ added: 1, updated: 0, kept: 3, duplicate: 0 });
    if (!("token" in staged)) return;
    const applied = await backups.applyImportRemote(staged.token);
    expect(applied.ok && applied.value.backup.reason).toBe("before-import");

    desktop.backend = previewCommands(desktop.store);
    on(desktop);
    expect(await titles()).toContain("Parse CSV line");
    const again = await stage(text);
    expect("token" in again && again.plan.counts.added).toBe(0);
  });

  it("cancelled import: closing the file picker or the preview writes nothing and makes no backup", async () => {
    const text = await exportText();
    on(desktop);
    const before = desktop.store.getItem(KEY);

    expect(await stage(null)).toEqual({ kind: "cancelled" });
    const staged = await stage(text.replace('"Retry with backoff"', '"Retry, tuned"'));
    if (!("token" in staged)) throw new Error("expected a plan");
    await backups.cancelImportRemote(staged.token);

    expect(desktop.store.getItem(KEY)).toBe(before);
    expect(await backups.listBackupsRemote()).toEqual({ ok: true, value: [] });
    expect(await backups.applyImportRemote(staged.token)).toEqual({ ok: false, error: { kind: "import-expired" } });
  });

  it("special characters and duplicates: code arrives byte for byte, and a copy under another id is skipped", async () => {
    const code = "\tif (x) {\r\n  return '✓ 👩‍💻 ‏שלום';‏\r\n}  \n";
    await library.createSnippetRemote({ title: "Special", code, language: "javascript" });
    const archive = JSON.parse(await exportText());
    const special = archive.snippets.find((s: { title: string }) => s.title === "Special");
    archive.snippets.push({ ...special, id: "copy-of-special" });

    on(desktop);
    const staged = await stage(JSON.stringify(archive));
    expect("token" in staged && staged.plan.counts).toMatchObject({ added: 1, duplicate: 1 });
    if ("token" in staged) await backups.applyImportRemote(staged.token);

    // Linked to the quick search: the imported snippet is found and copied exactly.
    const clipboard: string[] = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void clipboard.push(text) } });
    const listed = await library.listSnippetsRemote();
    const [found] = quickSearch(listed.ok ? listed.value : [], "special");
    expect(await copyText(pastePayload(found!.snippet).text)).toEqual({ ok: true });
    expect(clipboard).toEqual([code]);
  });

  it("closed clipboard after an import: the copy is refused, the import itself stands", async () => {
    const text = await exportText();
    on(desktop);
    const staged = await stage(text);
    if ("token" in staged) await backups.applyImportRemote(staged.token);
    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toEqual({ ok: false, cause: "clipboard is unavailable" });
    expect(await titles()).toHaveLength(3);
  });

  it("a wrong file is refused with its reason and nothing is staged", async () => {
    const refused = await backups.stageImport(async () => '{"name":"package"}');
    expect(refused).toEqual({ ok: false, error: { kind: "archive", reason: "not-an-archive" } });
    const bad = await backups.stageImport(async () =>
      JSON.stringify({ format: "snippet-desk", version: 1, snippets: [{ id: "a", title: "A", code: "", language: "js", tagIds: [], collectionId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" }] }),
    );
    expect(bad).toEqual({ ok: false, error: { kind: "archive", reason: "invalid-snippet", index: 0, field: "code" } });
  });

  it("damaged database: import and backups say so instead of writing over it", async () => {
    storage.setItem(KEY, '{"snippets": [trunc');
    laptop.backend = previewCommands(laptop.store);
    on(laptop);
    const staged = await backups.stageImport(async () => '{"format":"snippet-desk","version":1,"snippets":[]}');
    expect(!staged.ok && staged.error.kind).toBe("database-corrupted");
    expect(!(await backups.createBackupRemote()).ok).toBe(true);
    expect(storage.getItem(KEY)).toBe('{"snippets": [trunc');
    // The way out from stage 4 still works, and afterwards so does everything else.
    expect((await quick.setAsideDamagedLibraryRemote()).ok).toBe(true);
    expect((await backups.createBackupRemote()).ok).toBe(true);
  });

  it("a backup restores the library, and the state it replaced is backed up first", async () => {
    const saved = await backups.createBackupRemote();
    expect(saved.ok && saved.value.reason).toBe("manual");
    await library.createSnippetRemote({ title: "Added later", code: "2", language: "text" });

    const restored = await backups.restoreBackupRemote(saved.ok ? saved.value.name : "");
    expect(restored.ok && restored.value.reason).toBe("before-restore");
    expect(await titles()).not.toContain("Added later");
    expect(await backups.restoreBackupRemote("../elsewhere")).toEqual({
      ok: false,
      error: { kind: "backend", message: "backup-not-found" },
    });
  });
});
