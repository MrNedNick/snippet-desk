/** Code that must come back from the highlighter character for character. */
export const trickyCode: ReadonlyArray<readonly [label: string, language: string, code: string]> = [
  ["markup-like text in a string", "typescript", `const html = "<script>alert('x')</script> & &amp;";`],
  ["emoji and non-Latin text", "python", `greeting = "Привіт 👋🏽"  # 表情`],
  ["CRLF line endings and tabs", "rust", `fn main() {\r\n\tlet x = 1;\r\n}\r\n`],
  ["an unclosed string", "typescript", `const s = "never closed\nconst next = 1;`],
  ["an unclosed block comment", "css", `a { color: red; } /* runs to the end`],
  ["escaped quotes", "shell", `echo "say \\"hi\\"" 'it''s'`],
  ["a backslash at the very end", "typescript", `const s = "\\`],
  ["a template literal across lines", "typescript", "const t = `line 1\nline ${2}`;"],
  ["SQL keywords in any case", "sql", `SELECT id FROM snippets WHERE title LIKE '%o''k%' -- note`],
  ["only whitespace", "json", " \n\t "],
  ["an unknown language", "brainfuck", "++[>+<-]."],
];

export const snippet = {
  id: "id-1",
  title: "Debounce",
  code: "function debounce(fn, wait) {\n  let timer;\n}\n",
  language: "typescript",
  tagIds: [],
  collectionId: null,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};
