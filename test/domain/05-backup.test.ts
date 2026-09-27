import { describe, expect, it } from "vitest";
import {
  backupName,
  buildArchive,
  exportFileName,
  parseArchive,
  planImport,
  serializeArchive,
  MAX_ARCHIVE_SNIPPETS,
} from "../../src/domain/05-backup";
import { archiveJson, badArchives, library } from "../fixtures/05-backup/library";

const parsed = () => {
  const result = parseArchive(archiveJson);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

describe("export", () => {
  it("round-trips: what export writes, import reads back unchanged", () => {
    const archive = buildArchive(library, "2026-09-27T10:00:00.000Z");
    const again = parseArchive(serializeArchive(archive));
    expect(again).toEqual({ ok: true, value: archive });
  });

  it("suggests a dated file name", () => {
    expect(exportFileName("2026-09-27T10:00:00.000Z")).toBe("snippet-desk-2026-09-27.json");
  });
});

describe("parseArchive", () => {
  const cases = badArchives.map(([label, input, reason, index, field]) => ({ label, input, reason, index, field }));
  it.each(cases)("refuses $label", ({ input, reason, index, field }) => {
    const result = parseArchive(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe(reason);
    if (index !== undefined) expect(result.error.index).toBe(index);
    if (field !== undefined) expect(result.error.field).toBe(field);
  });

  it("refuses more snippets than one import takes", () => {
    const many = Array.from({ length: MAX_ARCHIVE_SNIPPETS + 1 }, () => ({}));
    expect(parseArchive(JSON.stringify({ format: "snippet-desk", version: 1, snippets: many }))).toMatchObject({
      ok: false,
      error: { reason: "too-many-snippets" },
    });
  });

  it("normalises tags the way the library stores them, and keeps code byte for byte", () => {
    const archive = parsed();
    expect(archive.snippets[0]!.tagIds).toEqual(["react", "hooks"]);
    const special = "\tif (x) {\r\n  return '✓ 👩‍💻';‏\r\n}  ";
    const raw = JSON.parse(archiveJson);
    raw.snippets[0].code = special;
    const result = parseArchive(JSON.stringify(raw));
    expect(result.ok && result.value.snippets[0]!.code).toBe(special);
  });
});

describe("planImport", () => {
  const plan = planImport(library, parsed(), () => "fresh-id");
  const action = (id: string) => plan.entries.find((entry) => entry.snippet.id === id)?.action;

  it("sorts every archive snippet into added, updated, kept or duplicate", () => {
    expect(action("debounce")).toBe("updated");
    expect(action("retry")).toBe("kept");
    expect(action("fetch")).toBe("added");
    expect(action("local-only-copy")).toBe("duplicate");
    expect(action("fts")).toBe("added");
    expect(plan.counts).toEqual({ added: 2, updated: 1, kept: 1, duplicate: 1 });
  });

  it("matches collections by name ignoring case, and gives a clashing new one a fresh id", () => {
    expect(plan.entries.find((e) => e.snippet.id === "fetch")!.snippet.collectionId).toBe("col-local-react");
    expect(plan.newCollections).toEqual([{ id: "fresh-id", name: "SQL recipes" }]);
    expect(plan.entries.find((e) => e.snippet.id === "fts")!.snippet.collectionId).toBe("fresh-id");
  });

  it("carries revisions over only for snippets it adds", () => {
    expect(plan.revisions.map((revision) => revision.id)).toEqual(["rev-1"]);
  });

  it("is a dry run: planning — and so cancelling — leaves the library untouched", () => {
    const before = structuredClone(library);
    planImport(library, parsed());
    expect(library).toEqual(before);
  });

  it("importing the same file twice adds nothing the second time", () => {
    const archive = parsed();
    const first = planImport(library, archive);
    const after = {
      ...library,
      snippets: [
        ...library.snippets.filter((s) => !first.entries.some((e) => e.action === "updated" && e.snippet.id === s.id)),
        ...first.entries.filter((e) => e.action === "added" || e.action === "updated").map((e) => e.snippet),
      ],
      collections: [...library.collections, ...first.newCollections],
    };
    expect(planImport(after, archive).counts.added).toBe(0);
  });
});

describe("backupName", () => {
  it("is sortable, file-system safe and says why the backup exists", () => {
    expect(backupName("2026-09-27T10:30:05.123Z", "before-import")).toBe(
      "snippet-desk-2026-09-27T10-30-05Z-before-import.sqlite3",
    );
  });
});
