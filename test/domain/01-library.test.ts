import { describe, expect, it } from "vitest";
import {
  buildClipboardPayload,
  copySnippetToClipboard,
  createSnippet,
  normalizeSearchQuery,
  reviseSnippet,
  searchSnippets,
} from "../../src/domain/01-library/operations";
import { fixedNow, sampleSnippets } from "../fixtures/01-library/snippets";

describe("createSnippet", () => {
  it("creates a snippet from valid input", () => {
    const result = createSnippet(
      { title: "New snippet", code: "console.log(1)", language: "javascript" },
      () => fixedNow,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("New snippet");
      expect(result.value.createdAt).toBe(fixedNow);
      expect(result.value.tagIds).toEqual([]);
    }
  });

  it("rejects an empty title", () => {
    const result = createSnippet({
      title: "   ",
      code: "console.log(1)",
      language: "javascript",
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "validation", reason: "title-empty", field: "title" },
    });
  });

  it("rejects empty code", () => {
    const result = createSnippet({
      title: "Title",
      code: "",
      language: "javascript",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("code-empty");
    }
  });
});

describe("reviseSnippet", () => {
  it("keeps the previous code as a revision", () => {
    const [snippet] = sampleSnippets;
    const result = reviseSnippet(snippet, "updated code", "cleanup", () => fixedNow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snippet.code).toBe("updated code");
      expect(result.value.revision.code).toBe(snippet.code);
      expect(result.value.revision.note).toBe("cleanup");
    }
  });

  it("rejects an empty replacement", () => {
    const [snippet] = sampleSnippets;
    const result = reviseSnippet(snippet, "", "note");
    expect(result.ok).toBe(false);
  });
});

describe("normalizeSearchQuery + searchSnippets", () => {
  it("finds a snippet by a term in its title", () => {
    const query = normalizeSearchQuery("debounce");
    expect(query.ok).toBe(true);
    if (query.ok) {
      const results = searchSnippets(sampleSnippets, query.value);
      expect(results).toHaveLength(1);
      expect(results[0].snippet.id).toBe("snippet-1");
    }
  });

  it("rejects an empty query", () => {
    const query = normalizeSearchQuery("   ");
    expect(query).toEqual({
      ok: false,
      error: { kind: "validation", reason: "query-empty", field: "query" },
    });
  });

  it("returns no results when nothing matches", () => {
    const query = normalizeSearchQuery("nonexistent-term");
    expect(query.ok).toBe(true);
    if (query.ok) {
      expect(searchSnippets(sampleSnippets, query.value)).toHaveLength(0);
    }
  });
});

describe("clipboard", () => {
  it("builds a payload from the snippet code", () => {
    const [snippet] = sampleSnippets;
    expect(buildClipboardPayload(snippet)).toEqual({ text: snippet.code });
  });

  it("returns the payload when the writer succeeds", () => {
    const [snippet] = sampleSnippets;
    const written: string[] = [];
    const result = copySnippetToClipboard(snippet, (text) => written.push(text));
    expect(result.ok).toBe(true);
    expect(written).toEqual([snippet.code]);
  });

  it("surfaces a distinguishable error when the clipboard is closed/unavailable", () => {
    const [snippet] = sampleSnippets;
    const closedClipboardWriter = () => {
      throw new Error("clipboard is closed");
    };
    const result = copySnippetToClipboard(snippet, closedClipboardWriter);
    expect(result).toEqual({
      ok: false,
      error: { kind: "clipboard-unavailable", cause: "clipboard is closed" },
    });
  });
});
