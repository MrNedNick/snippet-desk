/**
 * Integration coverage for "Редактор и подсветка": the editor's sequence —
 * open a snippet, check the draft in the domain, save through the adapter,
 * read the revisions, reopen — with every command answered by the browser
 * preview backend over one storage, which follows the same command names and
 * failure reasons as `src-tauri/src/commands.rs` (the Rust side has its own
 * copy of this scenario in `src-tauri/tests/02-editor.rs`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewCommands } from "../../src/adapters/browser-preview";
import { copySnippetToClipboard } from "../../src/domain/01-library/operations";
import { applyDraft, draftFrom, highlight } from "../../src/domain/02-editor";
import { trickyCode } from "../fixtures/02-editor/code";
import { MemoryStorage } from "../fixtures/memory-storage";

let storage: MemoryStorage;
let backend: ReturnType<typeof previewCommands>;
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => backend(cmd, args));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invoke(cmd, args),
  isTauri: () => false,
}));

const store = await import("../../src/adapters/snippet-store");

beforeEach(() => {
  storage = new MemoryStorage();
  backend = previewCommands(storage);
});

/** The app closing and opening again over the same storage. */
function restart() {
  backend = previewCommands(storage);
}

async function first() {
  const listed = await store.listSnippetsRemote();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value[0]!;
}

describe("edit -> save -> revisions -> restart", () => {
  it("main path: the new code is saved, the old one kept, and both come back after a restart", async () => {
    const snippet = await first();
    const draft = { ...draftFrom(snippet), code: `${snippet.code}// edited\n`, note: "comment" };
    expect(applyDraft(snippet, draft).ok).toBe(true);

    const saved = await store.updateSnippetRemote(snippet.id, draft);
    expect(saved.ok && saved.value.code).toBe(draft.code);

    restart();
    const reopened = await first();
    expect(reopened.id).toBe(snippet.id); // most recently edited comes first
    expect(reopened.code).toBe(draft.code);
    const revisions = await store.listRevisionsRemote(snippet.id);
    expect(revisions.ok && revisions.value.map((r) => [r.code, r.note])).toEqual([[snippet.code, "comment"]]);
  });

  it("special characters survive the save, the highlighter and the clipboard unchanged", async () => {
    const snippet = await first();
    const code = trickyCode.map(([, , text]) => text).join("\n");
    await store.updateSnippetRemote(snippet.id, { ...draftFrom(snippet), code });
    restart();
    const reopened = await first();
    expect(reopened.code).toBe(code);
    expect(highlight(reopened.code, reopened.language).tokens.map((t) => t.text).join("")).toBe(code);

    let copied = "";
    expect(copySnippetToClipboard(reopened, (text) => void (copied = text)).ok).toBe(true);
    expect(copied).toBe(code);
  });

  it("renaming alone leaves no revision", async () => {
    const snippet = await first();
    await store.updateSnippetRemote(snippet.id, { ...draftFrom(snippet), title: "Renamed" });
    const revisions = await store.listRevisionsRemote(snippet.id);
    expect(revisions.ok && revisions.value).toEqual([]);
  });

  it("duplicates: two snippets with the same code are edited independently", async () => {
    const snippet = await first();
    const twin = await store.createSnippetRemote({ title: snippet.title, code: snippet.code, language: snippet.language });
    if (!twin.ok) throw new Error("create failed");
    await store.updateSnippetRemote(twin.value.id, { ...draftFrom(twin.value), code: "changed" });
    const listed = await store.listSnippetsRemote();
    const codes = listed.ok ? listed.value.filter((s) => s.title === snippet.title).map((s) => s.code).sort() : [];
    expect(codes).toEqual([snippet.code, "changed"].sort());
  });

  it("negative path: an empty field and a deleted snippet are refused with their own reasons", async () => {
    const snippet = await first();
    expect(await store.updateSnippetRemote(snippet.id, { ...draftFrom(snippet), title: " " })).toMatchObject({
      ok: false,
      error: { kind: "validation", reason: "title-empty" },
    });
    expect(await store.updateSnippetRemote("gone", draftFrom(snippet))).toEqual({ ok: false, error: { kind: "not-found" } });
  });

  it("closed clipboard: copying the edited snippet reports it instead of failing silently", async () => {
    const snippet = await first();
    const result = copySnippetToClipboard(snippet, () => {
      throw new Error("clipboard is unavailable");
    });
    expect(result).toEqual({ ok: false, error: { kind: "clipboard-unavailable", cause: "clipboard is unavailable" } });
  });

  it("corrupt preview data starts again from the examples instead of breaking the page", async () => {
    storage.setItem("snippet-desk:browser-preview", "{not json");
    restart();
    const listed = await store.listSnippetsRemote();
    expect(listed.ok && listed.value.length).toBe(3);
  });

  // "Отмена импорта" from this milestone's card has no code yet: import arrives with M3 (T13–T18).
});
