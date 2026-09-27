import type { Revision, Snippet } from "../01-library/types";

export type TokenKind = "keyword" | "string" | "comment" | "number" | "plain";

/** A run of source text with one colour. Joining every token's text gives the input back unchanged. */
export interface Token {
  kind: TokenKind;
  text: string;
}

export type LanguageId = "typescript" | "rust" | "python" | "sql" | "css" | "shell" | "json";

export interface Highlighted {
  /** The language the code was read as, or `null` when it is not one the highlighter knows. */
  language: LanguageId | null;
  tokens: Token[];
}

/** What the editor holds while the user types; nothing is saved until it is applied. */
export interface EditorDraft {
  title: string;
  code: string;
  language: string;
  /** Why the code changed, kept with the revision that preserves the old code. */
  note: string;
}

export interface AppliedDraft {
  snippet: Snippet;
  /** The code as it was before this save, or `null` when the code itself did not change. */
  revision: Revision | null;
}
