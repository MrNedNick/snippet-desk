import { describe, expect, it } from "vitest";
import {
  classifyBackendFailure,
  MAX_QUICK_RESULTS,
  MAX_RECENT,
  parseShortcut,
  pastePayload,
  pruneRecent,
  quickSearch,
  recordUse,
} from "../../src/domain/04-quick";
import { corruptionMessages, invalidShortcuts, recent, snippets, validShortcuts } from "../fixtures/04-quick/library";

const ids = (results: ReturnType<typeof quickSearch>) => results.map((result) => result.snippet.id);

describe("parseShortcut", () => {
  it.each(validShortcuts)("accepts %j as %s", (raw, accelerator) => {
    expect(parseShortcut(raw)).toMatchObject({ ok: true, value: { accelerator } });
  });

  it.each(invalidShortcuts)("refuses %j with %s", (raw, reason) => {
    expect(parseShortcut(raw)).toEqual({ ok: false, error: { kind: "shortcut", reason, value: raw } });
  });

  it("allows a reserved key once another modifier makes it distinct", () => {
    expect(parseShortcut("CommandOrControl+Shift+V")).toMatchObject({ ok: true });
  });
});

describe("quickSearch", () => {
  it("with no query, lists recent uses first, then the most recently edited", () => {
    expect(ids(quickSearch(snippets, "", recent))).toEqual(["fts", "retry-rs", "fetch-retry", "debounce", "special"]);
  });

  it("requires every term, so typing more narrows the list", () => {
    expect(ids(quickSearch(snippets, "retry", recent))).toEqual(["retry-rs", "fetch-retry"]);
    expect(ids(quickSearch(snippets, "retry fetch", recent))).toEqual(["fetch-retry"]);
    expect(quickSearch(snippets, "retry python", recent)).toEqual([]);
  });

  it("ranks the start of a title above a tag above the code", () => {
    expect(ids(quickSearch(snippets, "fts"))).toEqual(["fts"]);
    expect(ids(quickSearch(snippets, "use"))[0]).toBe("debounce");
    expect(quickSearch(snippets, "search")[0]!.snippet.id).toBe("fts");
  });

  it("marks recent uses and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...snippets[0]!, id: `s${i}`, title: `Snippet ${i}` }));
    expect(quickSearch(many, "snippet")).toHaveLength(MAX_QUICK_RESULTS);
    expect(quickSearch(snippets, "", recent)[0]!.recentRank).toBe(0);
    expect(quickSearch(snippets, "", recent).at(-1)!.recentRank).toBeNull();
  });
});

describe("recent uses", () => {
  it("dedupes: using a snippet again moves it to the top instead of listing it twice", () => {
    const next = recordUse(recent, "retry-rs", "2026-09-27T09:00:00.000Z");
    expect(next.map((entry) => entry.snippetId)).toEqual(["retry-rs", "fts"]);
  });

  it(`keeps at most ${MAX_RECENT}`, () => {
    let list = recent;
    for (let i = 0; i < 30; i++) list = recordUse(list, `s${i}`, `2026-09-27T09:${String(i).padStart(2, "0")}:00.000Z`);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.snippetId).toBe("s29");
  });

  it("forgets snippets that were deleted", () => {
    expect(pruneRecent([...recent, { snippetId: "gone", usedAt: "x" }], snippets)).toEqual(recent);
  });
});

describe("pastePayload", () => {
  it("keeps special characters exactly: tabs, CRLF, emoji, zero-width joiner, RTL mark, trailing spaces", () => {
    const special = snippets.find((snippet) => snippet.id === "special")!;
    const payload = pastePayload(special);
    expect(payload.text).toBe(special.code);
    expect(payload.lines).toBe(3);
  });

  it("counts lines the way an editor does: a final line break does not add one", () => {
    const base = snippets[0]!;
    expect(pastePayload({ ...base, code: "a\nb\n" }).lines).toBe(2);
    expect(pastePayload({ ...base, code: "a\r\nb" }).lines).toBe(2);
    expect(pastePayload({ ...base, code: "\n" }).lines).toBe(1);
  });
});

describe("classifyBackendFailure — damaged database", () => {
  it.each(corruptionMessages)("recognises %j", (message) => {
    expect(classifyBackendFailure(message)).toEqual({ kind: "database-corrupted", detail: message });
  });

  it("leaves other failures alone", () => {
    expect(classifyBackendFailure("snippet-not-found")).toBeNull();
    expect(classifyBackendFailure("database is locked")).toBeNull();
  });
});
