import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const store = await import("../../src/adapters/organize-store");

describe("organize-store", () => {
  it("sends each command with the argument names the Rust side expects", async () => {
    invoke.mockResolvedValue(null);
    await store.setTagsRemote("id-1", ["react"]);
    expect(invoke).toHaveBeenLastCalledWith("set_snippet_tags", { id: "id-1", tags: ["react"] });
    await store.setCollectionRemote("id-1", null);
    expect(invoke).toHaveBeenLastCalledWith("set_snippet_collection", { id: "id-1", collectionId: null });
    await store.createCollectionRemote("React");
    expect(invoke).toHaveBeenLastCalledWith("create_collection", { name: "React" });
    await store.renameCollectionRemote("c1", "Vue");
    expect(invoke).toHaveBeenLastCalledWith("rename_collection", { id: "c1", name: "Vue" });
    await store.deleteCollectionRemote("c1");
    expect(invoke).toHaveBeenLastCalledWith("delete_collection", { id: "c1" });
    await store.listCollectionsRemote();
    expect(invoke).toHaveBeenLastCalledWith("list_collections", {});
  });

  it.each([
    ["collection-exists", { kind: "organize", reason: "collection-exists", value: "React" }],
    ["snippet-not-found", { kind: "not-found" }],
    ["disk I/O error", { kind: "backend", message: "disk I/O error" }],
  ])("maps %s", async (reason, error) => {
    invoke.mockRejectedValueOnce(reason);
    expect(await store.createCollectionRemote("React")).toEqual({ ok: false, error });
  });
});
