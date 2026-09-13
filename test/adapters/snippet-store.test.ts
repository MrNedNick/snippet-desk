import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { createSnippetRemote, searchSnippetsRemote } = await import("../../src/adapters/snippet-store");

describe("createSnippetRemote", () => {
  it("returns the persisted snippet on success", async () => {
    const persisted = {
      id: "snippet-1",
      title: "Title",
      code: "code",
      language: "ts",
      tagIds: [],
      collectionId: null,
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    };
    invoke.mockResolvedValueOnce(persisted);

    const result = await createSnippetRemote({ title: "Title", code: "code", language: "ts" });

    expect(result).toEqual({ ok: true, value: persisted });
    expect(invoke).toHaveBeenCalledWith("create_snippet", {
      input: { title: "Title", code: "code", language: "ts" },
    });
  });

  it("maps a known backend reason to a validation error", async () => {
    invoke.mockRejectedValueOnce("title-empty");

    const result = await createSnippetRemote({ title: "", code: "code", language: "ts" });

    expect(result).toEqual({
      ok: false,
      error: { kind: "validation", reason: "title-empty", field: "title" },
    });
  });
});

describe("searchSnippetsRemote", () => {
  it("wraps an unrecognized backend failure as a backend error", async () => {
    invoke.mockRejectedValueOnce("database disk image is malformed");

    const result = await searchSnippetsRemote({ raw: "foo", terms: ["foo"] });

    expect(result).toEqual({
      ok: false,
      error: { kind: "backend", message: "database disk image is malformed" },
    });
  });
});
