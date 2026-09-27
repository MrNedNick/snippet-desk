/**
 * Integration coverage for "Системный поиск и clipboard": open the quick search, find a snippet, copy
 * it, and have it offered first next time — through the adapters and the domain together, with the
 * commands answered by the browser preview backend (same names and reasons as the Rust side, which
 * has its own copy of the recent-use and damaged-file scenarios in `src-tauri/tests/04-quick.rs`).
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

const KEY = "snippet-desk:browser-preview";
let clipboard: string[];

beforeEach(() => {
  storage = new MemoryStorage();
  backend = previewCommands(storage);
  clipboard = [];
  vi.stubGlobal("navigator", { clipboard: { writeText: async (text: string) => void clipboard.push(text) } });
});

afterEach(() => vi.unstubAllGlobals());

const restart = () => (backend = previewCommands(storage));

async function all() {
  const listed = await library.listSnippetsRemote();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value;
}

async function recent() {
  const listed = await quick.listRecentUsesRemote();
  if (!listed.ok) throw new Error(listed.error.kind);
  return listed.value;
}

/** What the palette does on Enter: copy, and record the use only if the copy worked. */
async function pick(query: string) {
  const [first] = quickSearch(await all(), query, await recent());
  if (!first) throw new Error(`nothing matches ${query}`);
  const copied = await copyText(pastePayload(first.snippet).text);
  if (copied.ok) await quick.recordSnippetUseRemote(first.snippet.id);
  return { snippet: first.snippet, copied };
}

describe("quick search and clipboard", () => {
  it("main path: find, copy, and get it offered first after a restart", async () => {
    const { snippet, copied } = await pick("retry");
    expect(copied).toEqual({ ok: true });
    expect(clipboard).toEqual([snippet.code]);

    restart();
    const [top] = quickSearch(await all(), "", await recent());
    expect(top!.snippet.id).toBe(snippet.id);
    expect(top!.recentRank).toBe(0);
  });

  it("closed clipboard: the copy is reported as failed and nothing is recorded as used", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("Write permission denied.");
        },
      },
    });
    const { copied } = await pick("retry");
    expect(copied).toEqual({ ok: false, cause: "Write permission denied." });
    expect(await recent()).toEqual([]);

    vi.stubGlobal("navigator", {});
    expect(await copyText("x")).toEqual({ ok: false, cause: "clipboard is unavailable" });
  });

  it("special characters reach the clipboard exactly as saved", async () => {
    const code = "if (x) {\r\n\treturn \"✓ 👩‍💻 ‏שלום\";‏\r\n}  \n";
    const created = await library.createSnippetRemote({ title: "Special characters", code, language: "javascript" });
    expect(created.ok).toBe(true);

    const { snippet, copied } = await pick("special");
    expect(copied.ok).toBe(true);
    expect(clipboard[0]).toBe(code);
    expect(pastePayload(snippet).lines).toBe(3);
  });

  it("duplicates: copying the same snippet twice keeps one entry, moved to the top", async () => {
    await pick("retry");
    await pick("debounce");
    await pick("retry");
    const ids = (await recent()).map((entry) => entry.snippetId);
    expect(ids).toEqual(["seed-retry", "seed-debounce"]);
    expect(await quick.recordSnippetUseRemote("gone")).toEqual({ ok: false, error: { kind: "not-found" } });
  });

  it("damaged database: every call says so, the data is kept, and a new library starts on request", async () => {
    storage.setItem(KEY, '{"snippets": [trunc');
    restart();

    const health = await quick.libraryHealthRemote();
    expect(health.ok && health.value.status).toBe("damaged");
    const listed = await quick.listRecentUsesRemote();
    expect(!listed.ok && listed.error.kind).toBe("database-corrupted");
    expect(storage.getItem(KEY)).toBe('{"snippets": [trunc');

    const kept = await quick.setAsideDamagedLibraryRemote();
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(storage.getItem(kept.value)).toBe('{"snippets": [trunc');
    const healed = await quick.libraryHealthRemote();
    expect(healed.ok && healed.value.status).toBe("ok");
    expect(await all()).toHaveLength(3);
    expect(await quick.setAsideDamagedLibraryRemote()).toMatchObject({ ok: false });
  });

  it("the global shortcut: a bad one is refused with its reason, a good one survives a restart", async () => {
    const refused = await quick.setQuickShortcutRemote("cmd+v");
    expect(!refused.ok && refused.error.kind === "backend" && refused.error.message).toBe(
      "shortcut-unavailable: shortcut-reserved",
    );

    const saved = await quick.setQuickShortcutRemote("alt+shift+k");
    expect(saved.ok && saved.value.accelerator).toBe("Alt+Shift+K");
    restart();
    const status = await quick.getQuickShortcutRemote();
    expect(status.ok && status.value).toMatchObject({ accelerator: "Alt+Shift+K", registered: false });
  });

  // "Отмена импорта" from this milestone's card has no code yet: import arrives with M3 (T13–T18).
});
