import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { updateSnippetRemote, listRevisionsRemote, createSnippetRemote } = await import("../../src/adapters/snippet-store");

const draft = { title: "Debounce", code: "let a = 1;", language: "ts", note: "why" };

describe("updateSnippetRemote", () => {
  it("sends the whole draft with the id to update_snippet", async () => {
    invoke.mockResolvedValueOnce({ id: "id-1", ...draft });
    await updateSnippetRemote("id-1", draft);
    expect(invoke).toHaveBeenCalledWith("update_snippet", { input: { id: "id-1", ...draft } });
  });

  it.each([
    ["snippet-not-found", { kind: "not-found" }],
    ["code-empty", { kind: "validation", reason: "code-empty", field: "code" }],
    ["database disk image is malformed", { kind: "backend", message: "database disk image is malformed" }],
  ])("maps %s", async (reason, error) => {
    invoke.mockRejectedValueOnce(reason);
    expect(await updateSnippetRemote("id-1", draft)).toEqual({ ok: false, error });
  });

  it("creating never reports not-found: that reason only exists for edits", async () => {
    invoke.mockRejectedValueOnce("snippet-not-found");
    expect(await createSnippetRemote(draft)).toEqual({ ok: false, error: { kind: "backend", message: "snippet-not-found" } });
  });
});

describe("listRevisionsRemote", () => {
  it("asks for one snippet's revisions and reports a backend failure as such", async () => {
    invoke.mockResolvedValueOnce([]);
    expect(await listRevisionsRemote("id-1")).toEqual({ ok: true, value: [] });
    expect(invoke).toHaveBeenLastCalledWith("list_revisions", { snippetId: "id-1" });

    invoke.mockRejectedValueOnce("db-lock-poisoned");
    expect(await listRevisionsRemote("id-1")).toEqual({ ok: false, error: { kind: "backend", message: "db-lock-poisoned" } });
  });
});
