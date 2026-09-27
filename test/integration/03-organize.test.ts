/**
 * Integration coverage for "Теги и коллекции": the library's sequence —
 * create a collection, tag and file a snippet, filter, rename, delete,
 * restart — through the adapters and the domain together, with the commands
 * answered by the browser preview backend (the same names and reasons as the
 * Rust side, which has its own copy of this scenario in
 * `src-tauri/tests/03-organize.rs`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewCommands } from "../../src/adapters/browser-preview";
import { filterSnippets, parseTags, tagCounts } from "../../src/domain/03-organize";
import { MemoryStorage } from "../fixtures/memory-storage";

let storage: MemoryStorage;
let backend: ReturnType<typeof previewCommands>;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => backend(cmd, args),
  isTauri: () => false,
}));

const library = await import("../../src/adapters/snippet-store");
const organize = await import("../../src/adapters/organize-store");

beforeEach(() => {
  storage = new MemoryStorage();
  backend = previewCommands(storage);
});

const restart = () => (backend = previewCommands(storage));

async function all() {
  const listed = await library.listSnippetsRemote();
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value;
}

async function byTitle(title: string) {
  return (await all()).find((s) => s.title === title)!;
}

describe("tags and collections", () => {
  it("main path: file and tag a snippet, filter to it, and find it the same way after a restart", async () => {
    const created = await organize.createCollectionRemote("  Backend   helpers ");
    expect(created.ok && created.value.name).toBe("Backend helpers");
    if (!created.ok) return;

    const retry = await byTitle("Retry with backoff");
    const tags = parseTags("Rust, error handling");
    if (!tags.ok) throw new Error("tags");
    await organize.setTagsRemote(retry.id, tags.value);
    await organize.setCollectionRemote(retry.id, created.value.id);

    restart();
    const snippets = await all();
    const shown = filterSnippets(snippets, { collection: created.value.id, tag: "error-handling" });
    expect(shown.map((s) => s.title)).toEqual(["Retry with backoff"]);
    expect(tagCounts(snippets).find((t) => t.tag === "rust")?.count).toBe(1);
  });

  it("duplicates: repeated tags collapse, a collection name that differs only in case is refused", async () => {
    const retry = await byTitle("Retry with backoff");
    const tagged = await organize.setTagsRemote(retry.id, ["Rust", "rust", " RUST "]);
    expect(tagged.ok && tagged.value.tagIds).toEqual(["rust"]);

    await organize.createCollectionRemote("Snippets");
    expect(await organize.createCollectionRemote("SNIPPETS")).toEqual({
      ok: false,
      error: { kind: "organize", reason: "collection-exists", value: "SNIPPETS" },
    });
  });

  it("deleting a collection keeps its snippets, unfiled, and a filter on it shows nothing", async () => {
    const collections = await organize.listCollectionsRemote();
    const frontend = collections.ok ? collections.value.find((c) => c.name === "Frontend")! : null;
    if (!frontend) throw new Error("seed collection missing");
    await organize.deleteCollectionRemote(frontend.id);

    const snippets = await all();
    expect(snippets).toHaveLength(3);
    expect(snippets.every((s) => s.collectionId === null)).toBe(true);
    expect(filterSnippets(snippets, { collection: frontend.id, tag: null })).toEqual([]);
    expect(filterSnippets(snippets, { collection: "unfiled", tag: null })).toHaveLength(3);
  });

  it("negative path: a missing collection or snippet is named, and nothing changes", async () => {
    const retry = await byTitle("Retry with backoff");
    expect(await organize.setCollectionRemote(retry.id, "gone")).toMatchObject({
      ok: false,
      error: { reason: "collection-not-found" },
    });
    expect(await organize.setTagsRemote("gone", ["x"])).toEqual({ ok: false, error: { kind: "not-found" } });
    expect(await organize.setTagsRemote(retry.id, ["!!!"])).toMatchObject({ ok: false, error: { reason: "tag-empty" } });
    expect((await byTitle("Retry with backoff")).tagIds).toEqual(retry.tagIds);
  });

  it("preview data saved before collections existed still opens", async () => {
    storage.setItem("snippet-desk:browser-preview", JSON.stringify({ snippets: [], revisions: [] }));
    restart();
    expect(await organize.listCollectionsRemote()).toEqual({ ok: true, value: [] });
  });
});
