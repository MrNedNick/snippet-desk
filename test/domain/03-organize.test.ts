import { describe, expect, it } from "vitest";
import {
  collectionCounts,
  filterSnippets,
  normalizeTag,
  parseTags,
  sortCollections,
  tagCounts,
  validateCollectionName,
} from "../../src/domain/03-organize";
import { collections, duplicateTagInputs, snippets } from "../fixtures/03-organize/library";

describe("tags", () => {
  it.each(duplicateTagInputs)("duplicates collapse: %j", (input, tags) => {
    expect(parseTags(input)).toEqual({ ok: true, value: tags });
  });

  it.each([
    ["   ", "tag-empty"],
    ["!!!", "tag-empty"],
    ["x".repeat(33), "tag-too-long"],
  ])("refuses %j with %s", (raw, reason) => {
    expect(normalizeTag(raw)).toEqual({ ok: false, error: { kind: "organize", reason, value: raw } });
  });

  it("refuses more tags than a snippet holds, and a bad piece anywhere in the list", () => {
    const many = Array.from({ length: 13 }, (_, i) => `t${i}`).join(",");
    expect(parseTags(many)).toMatchObject({ ok: false, error: { reason: "too-many-tags" } });
    expect(parseTags("react, " + "y".repeat(40))).toMatchObject({ ok: false, error: { reason: "tag-too-long" } });
  });

  it("counts tags across the library, most used first", () => {
    expect(tagCounts(snippets)).toEqual([
      { tag: "react", count: 2 },
      { tag: "hooks", count: 1 },
      { tag: "search", count: 1 },
      { tag: "sqlite", count: 1 },
    ]);
  });
});

describe("collections", () => {
  it("trims and collapses the name but keeps its case", () => {
    expect(validateCollectionName("  Rust   snippets ", collections)).toEqual({ ok: true, value: "Rust snippets" });
  });

  it("a name that differs only in case is a duplicate", () => {
    expect(validateCollectionName("react", collections)).toMatchObject({ ok: false, error: { reason: "collection-exists" } });
    expect(validateCollectionName("sql RECIPES", collections)).toMatchObject({ ok: false, error: { reason: "collection-exists" } });
  });

  it("renaming a collection to its own name in another case is allowed", () => {
    expect(validateCollectionName("REACT", collections, "col-react")).toEqual({ ok: true, value: "REACT" });
  });

  it.each([
    ["", "collection-empty"],
    ["z".repeat(61), "collection-too-long"],
  ])("refuses %j with %s", (raw, reason) => {
    expect(validateCollectionName(raw, collections)).toMatchObject({ ok: false, error: { reason } });
  });

  it("sorts alphabetically ignoring case", () => {
    expect(sortCollections([{ id: "1", name: "b" }, { id: "2", name: "A" }, { id: "3", name: "a2" }]).map((c) => c.name)).toEqual(["A", "a2", "b"]);
  });

  it("counts snippets per collection and the unfiled ones", () => {
    const counts = collectionCounts(snippets);
    expect(counts.unfiled).toBe(1);
    expect(Object.fromEntries(counts.byId)).toEqual({ "col-react": 2, "col-sql": 1 });
  });
});

describe("filterSnippets", () => {
  const ids = (filter: Parameters<typeof filterSnippets>[1]) => filterSnippets(snippets, filter).map((s) => s.id);

  it("everything, one collection, the unfiled ones, a tag, and both together", () => {
    expect(ids({ collection: null, tag: null })).toEqual(["a", "b", "c", "d"]);
    expect(ids({ collection: "col-react", tag: null })).toEqual(["a", "b"]);
    expect(ids({ collection: "unfiled", tag: null })).toEqual(["d"]);
    expect(ids({ collection: null, tag: "react" })).toEqual(["a", "b"]);
    expect(ids({ collection: "col-react", tag: "hooks" })).toEqual(["a"]);
  });

  it("a collection that was deleted shows nothing, not the whole library", () => {
    expect(ids({ collection: "gone", tag: null })).toEqual([]);
  });
});
