import type { LanguageId } from "./types";

export interface LanguageSpec {
  label: string;
  keywords: ReadonlySet<string>;
  /** Starts of comments that run to the end of the line. */
  lineComments: readonly string[];
  blockComment: readonly [open: string, close: string] | null;
  /** Quote characters that open a string. */
  quotes: readonly string[];
  caseInsensitive: boolean;
}

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

export const LANGUAGES: Readonly<Record<LanguageId, LanguageSpec>> = {
  typescript: {
    label: "TypeScript / JavaScript",
    keywords: words(`
      abstract as async await break case catch class const continue debugger default delete do else enum
      export extends false finally for from function get if implements import in instanceof interface let
      new null of private protected public readonly return satisfies set static super switch this throw
      true try type typeof undefined var void while with yield`),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    caseInsensitive: false,
  },
  rust: {
    label: "Rust",
    keywords: words(`
      as async await break const continue crate dyn else enum extern false fn for if impl in let loop match
      mod move mut pub ref return self Self static struct super trait true type unsafe use where while`),
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    caseInsensitive: false,
  },
  python: {
    label: "Python",
    keywords: words(`
      False None True and as assert async await break class continue def del elif else except finally for
      from global if import in is lambda nonlocal not or pass raise return try while with yield`),
    lineComments: ["#"],
    blockComment: null,
    quotes: ['"', "'"],
    caseInsensitive: false,
  },
  sql: {
    label: "SQL",
    keywords: words(`
      select from where and or not insert into values update set delete create table index view drop alter
      join left right inner outer on group by order having limit offset as distinct null is in like between
      case when then else end primary key references default union all exists returning with`),
    lineComments: ["--"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
    caseInsensitive: true,
  },
  css: {
    label: "CSS",
    keywords: words(`important media supports keyframes import layer container from to and not only screen`),
    lineComments: [],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    caseInsensitive: true,
  },
  shell: {
    label: "Shell",
    keywords: words(`if then else elif fi for in do done while until case esac function return export local echo`),
    lineComments: ["#"],
    blockComment: null,
    quotes: ['"', "'"],
    caseInsensitive: false,
  },
  json: {
    label: "JSON",
    keywords: words(`true false null`),
    lineComments: [],
    blockComment: null,
    quotes: ['"'],
    caseInsensitive: false,
  },
};

const ALIASES: Readonly<Record<string, LanguageId>> = {
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  js: "typescript",
  jsx: "typescript",
  javascript: "typescript",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  sql: "sql",
  sqlite: "sql",
  postgres: "sql",
  css: "css",
  scss: "css",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  shell: "shell",
  json: "json",
};

/** The highlighter's language for what the user typed (`TS`, `bash`, …), or `null` for anything else. */
export function resolveLanguage(raw: string): LanguageId | null {
  return ALIASES[raw.trim().toLowerCase()] ?? null;
}

/** Names offered in the language field. */
export const LANGUAGE_SUGGESTIONS: readonly string[] = ["typescript", "javascript", "rust", "python", "sql", "css", "bash", "json"];
