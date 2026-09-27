import { describe, expect, it } from "vitest";
import { applyDraft, draftFrom, highlight, isDirty, resolveLanguage } from "../../src/domain/02-editor";
import { snippet, trickyCode } from "../fixtures/02-editor/code";

const kinds = (code: string, language: string) =>
  highlight(code, language).tokens.filter((token) => token.kind !== "plain").map((token) => [token.kind, token.text]);

describe("highlight", () => {
  it.each(trickyCode)("keeps every character: %s", (_, language, code) => {
    expect(highlight(code, language).tokens.map((token) => token.text).join("")).toBe(code);
  });

  it("colours keywords, strings, numbers and comments", () => {
    expect(kinds(`const n = 42; // answer\nreturn "ok";`, "ts")).toEqual([
      ["keyword", "const"],
      ["number", "42"],
      ["comment", "// answer"],
      ["keyword", "return"],
      ["string", '"ok"'],
    ]);
  });

  it("markup inside a string stays a string, not markup", () => {
    const tokens = highlight(trickyCode[0]![2], "typescript").tokens;
    expect(tokens.find((token) => token.kind === "string")?.text).toBe(`"<script>alert('x')</script> & &amp;"`);
  });

  it("an unclosed string stops at the end of its line, so the next line is still read as code", () => {
    expect(kinds(`const s = "never closed\nconst next = 1;`, "typescript")).toEqual([
      ["keyword", "const"],
      ["string", '"never closed'],
      ["keyword", "const"],
      ["number", "1"],
    ]);
  });

  it("digits inside a name are not numbers", () => {
    expect(kinds("let utf8 = x2;", "rust")).toEqual([["keyword", "let"]]);
  });

  it("SQL keywords match in any case; a doubled quote stays inside the string", () => {
    expect(kinds(trickyCode[8]![2], "sql")).toEqual([
      ["keyword", "SELECT"],
      ["keyword", "FROM"],
      ["keyword", "WHERE"],
      ["keyword", "LIKE"],
      ["string", "'%o''k%'"],
      ["comment", "-- note"],
    ]);
  });

  it("an unknown language is shown plain, not refused", () => {
    expect(highlight("++[>+<-].", "brainfuck")).toEqual({ language: null, tokens: [{ kind: "plain", text: "++[>+<-]." }] });
    expect(highlight("", "typescript").tokens).toEqual([]);
  });
});

describe("resolveLanguage", () => {
  it.each([
    ["TS", "typescript"],
    [" javascript ", "typescript"],
    ["bash", "shell"],
    ["rs", "rust"],
    ["Brainfuck", null],
  ])("%s → %s", (raw, id) => {
    expect(resolveLanguage(raw)).toBe(id);
  });
});

describe("applyDraft", () => {
  const now = () => "2026-09-27T10:00:00.000Z";

  it("a new version of the code keeps the old one as a revision with the note", () => {
    const draft = { ...draftFrom(snippet), code: "const debounce = () => {};\n", note: " arrow version " };
    const result = applyDraft(snippet, draft, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snippet).toMatchObject({ code: draft.code, updatedAt: now() });
    expect(result.value.revision).toMatchObject({ snippetId: "id-1", code: snippet.code, note: "arrow version" });
  });

  it("renaming alone saves without a revision; title and language are trimmed, code is not", () => {
    const result = applyDraft(snippet, { ...draftFrom(snippet), title: "  Debounce (fn)  ", language: " rust " }, now);
    expect(result.ok && result.value).toMatchObject({ snippet: { title: "Debounce (fn)", language: "rust" }, revision: null });

    const spaced = applyDraft(snippet, { ...draftFrom(snippet), code: `  ${snippet.code}\n` }, now);
    expect(spaced.ok && spaced.value.snippet.code).toBe(`  ${snippet.code}\n`);
  });

  it("special characters in the code are saved exactly", () => {
    const code = trickyCode.map(([, , text]) => text).join("\n");
    const result = applyDraft(snippet, { ...draftFrom(snippet), code }, now);
    expect(result.ok && result.value.snippet.code).toBe(code);
  });

  it.each([
    ["title", { title: "   " }, "title-empty"],
    ["code", { code: "" }, "code-empty"],
    ["language", { language: "" }, "language-empty"],
  ] as const)("an empty %s is refused with its own reason", (_, patch, reason) => {
    const result = applyDraft(snippet, { ...draftFrom(snippet), ...patch }, now);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ kind: "validation", reason }) });
  });

  it("nothing changed — or only the note — is its own error, not a silent empty save", () => {
    expect(applyDraft(snippet, { ...draftFrom(snippet), note: "just a note" }, now)).toEqual({ ok: false, error: { kind: "no-changes" } });
    expect(isDirty(snippet, { ...draftFrom(snippet), title: "Debounce " })).toBe(false);
  });
});
