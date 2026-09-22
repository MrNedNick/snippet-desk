/**
 * Integration coverage for "Локальная библиотека и FTS": unlike the
 * per-file unit tests in test/domain and test/adapters, this drives the
 * domain layer and the adapters *together*, the same sequence LibraryView
 * runs (create -> refresh list -> search -> copy), through a mocked Tauri
 * `invoke` standing in for the Rust command boundary.
 *
 * "Отмена импорта" (an edge case named on this milestone's card) isn't
 * covered here on purpose — import/export doesn't exist yet, it's scheduled
 * for M3 (T13-18) in plan/blueprints/snippet-desk.md.
 */
import { describe, expect, it, vi } from "vitest";
import { normalizeSearchQuery, copySnippetToClipboard } from "../../src/domain/01-library/operations";
import type { Snippet } from "../../src/domain/01-library/types";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const {
  createSnippetRemote,
  listSnippetsRemote,
  searchSnippetsRemote,
} = await import("../../src/adapters/snippet-store");

function persistedFrom(id: string, title: string, code: string, language: string): Snippet {
  return {
    id,
    title,
    code,
    language,
    tagIds: [],
    collectionId: null,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

/** Mirrors LibraryView's `formError` derivation, so the test proves the same mapping the UI relies on. */
function formErrorFrom(error: { kind: string; reason?: string; message?: string }): string {
  return error.kind === "validation" ? (error.reason as string) : (error.message as string);
}

describe("create -> list -> search main scenario", () => {
  it("a created snippet is immediately visible through list and matchable through search", async () => {
    const persisted = persistedFrom("id-1", "Debounce a function", "fn debounce() {}", "rust");
    invoke.mockResolvedValueOnce(persisted); // create_snippet
    invoke.mockResolvedValueOnce([persisted]); // list_snippets
    invoke.mockResolvedValueOnce([persisted]); // search_snippets

    const created = await createSnippetRemote({ title: persisted.title, code: persisted.code, language: persisted.language });
    expect(created).toEqual({ ok: true, value: persisted });

    const listed = await listSnippetsRemote();
    expect(listed).toEqual({ ok: true, value: [persisted] });

    const query = normalizeSearchQuery("debounce");
    expect(query.ok).toBe(true);
    const found = query.ok ? await searchSnippetsRemote(query.value) : null;
    expect(found).toEqual({ ok: true, value: [persisted] });
  });
});

describe("negative path: backend validation surfaces through to the UI's error text", () => {
  it("an empty title rejected by the backend becomes a distinguishable, displayable reason", async () => {
    invoke.mockRejectedValueOnce("title-empty");

    const result = await createSnippetRemote({ title: "  ", code: "code", language: "rust" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(formErrorFrom(result.error)).toBe("title-empty");
    }
  });

  it("an unrecognized backend failure (e.g. a corrupted database) is distinguishable from a validation error", async () => {
    invoke.mockRejectedValueOnce("database disk image is malformed");

    const result = await listSnippetsRemote();

    expect(result).toEqual({
      ok: false,
      error: { kind: "backend", message: "database disk image is malformed" },
    });
  });
});

describe("special characters round-trip through the full create -> list chain", () => {
  it("FTS-operator characters in title/code are passed through untouched", async () => {
    const oddTitle = 'He said "OR" -x AND y*';
    const oddCode = 'let s = "quote\\"inside\\""; // OR -1';
    const persisted = persistedFrom("id-2", oddTitle, oddCode, "rust");
    invoke.mockResolvedValueOnce(persisted);
    invoke.mockResolvedValueOnce([persisted]);

    const created = await createSnippetRemote({ title: oddTitle, code: oddCode, language: "rust" });
    expect(created.ok && created.value.title).toBe(oddTitle);
    expect(created.ok && created.value.code).toBe(oddCode);

    const listed = await listSnippetsRemote();
    expect(listed.ok && listed.value[0].title).toBe(oddTitle);
  });
});

describe("duplicates are allowed by design, not an error", () => {
  it("two snippets with identical title/code/language both persist as distinct entries", async () => {
    const first = persistedFrom("id-3", "Retry with backoff", "fn retry() {}", "rust");
    const second = persistedFrom("id-4", "Retry with backoff", "fn retry() {}", "rust");
    invoke.mockResolvedValueOnce(first);
    invoke.mockResolvedValueOnce(second);
    invoke.mockResolvedValueOnce([second, first]);

    const createdFirst = await createSnippetRemote({ title: first.title, code: first.code, language: first.language });
    const createdSecond = await createSnippetRemote({ title: second.title, code: second.code, language: second.language });
    expect(createdFirst.ok && createdSecond.ok).toBe(true);
    expect(createdFirst.ok && createdSecond.ok && createdFirst.value.id).not.toBe(
      createdSecond.ok && createdSecond.value.id,
    );

    const listed = await listSnippetsRemote();
    expect(listed.ok && listed.value).toHaveLength(2);
  });
});

describe("clipboard closed edge case surfaces the same feedback text the UI shows", () => {
  it("a throwing clipboard writer becomes the 'Couldn't copy: ...' message LibraryView renders", () => {
    const snippet = persistedFrom("id-5", "Clip me", "code", "rust");
    const closedClipboard = () => {
      throw new Error("clipboard is unavailable");
    };

    const result = copySnippetToClipboard(snippet, closedClipboard);

    expect(result.ok).toBe(false);
    const feedback = result.ok ? "" : `Couldn't copy: ${result.error.cause}`;
    expect(feedback).toBe("Couldn't copy: clipboard is unavailable");
  });
});
