import type { Collection, Snippet } from "../../../src/domain/01-library/types";

export const collections: Collection[] = [
  { id: "col-react", name: "React" },
  { id: "col-sql", name: "SQL recipes" },
];

const base = { language: "typescript", createdAt: "2026-09-27T00:00:00.000Z", updatedAt: "2026-09-27T00:00:00.000Z" };

export const snippets: Snippet[] = [
  { ...base, id: "a", title: "useDebounce", code: "…", tagIds: ["react", "hooks"], collectionId: "col-react" },
  { ...base, id: "b", title: "useToggle", code: "…", tagIds: ["react"], collectionId: "col-react" },
  { ...base, id: "c", title: "FTS query", code: "…", language: "sql", tagIds: ["sqlite", "search"], collectionId: "col-sql" },
  { ...base, id: "d", title: "Retry", code: "…", language: "rust", tagIds: [], collectionId: null },
];

/** Ways of typing the same tags that must end up as one list. */
export const duplicateTagInputs: ReadonlyArray<readonly [input: string, tags: string[]]> = [
  ["React, react, REACT", ["react"]],
  ["React Hooks, react-hooks,  react   hooks ", ["react-hooks"]],
  ["c++, C++, node.js, c#", ["c++", "node.js", "c#"]],
  ["база даних, БАЗА ДАНИХ", ["база-даних"]],
  [" , ,react,, ", ["react"]],
  ["", []],
];
