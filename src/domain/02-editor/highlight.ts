import { LANGUAGES, resolveLanguage, type LanguageSpec } from "./languages";
import type { Highlighted, Token, TokenKind } from "./types";

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xob][\da-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)/iy;

function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (text.length === 0) return;
  const last = tokens[tokens.length - 1];
  // Neighbouring runs of one kind merge, so plain text stays one token between highlights.
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

/** End of a string opened at `start`; an unclosed string runs to the end of its line (or of the code). */
function stringEnd(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    const char = code[i];
    if (char === "\\") i += 2;
    else if (char === quote) return i + 1;
    else if (char === "\n" && quote !== "`") return i;
    else i += 1;
  }
  return code.length;
}

function scan(code: string, spec: LanguageSpec): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < code.length) {
    const line = spec.lineComments.find((start) => code.startsWith(start, i));
    if (line) {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      push(tokens, "comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    if (spec.blockComment && code.startsWith(spec.blockComment[0], i)) {
      const close = code.indexOf(spec.blockComment[1], i + spec.blockComment[0].length);
      const stop = close === -1 ? code.length : close + spec.blockComment[1].length;
      push(tokens, "comment", code.slice(i, stop));
      i = stop;
      continue;
    }
    const char = code[i]!;
    if (spec.quotes.includes(char)) {
      const stop = stringEnd(code, i, char);
      push(tokens, "string", code.slice(i, stop));
      i = stop;
      continue;
    }
    NUMBER.lastIndex = i;
    const previous = i > 0 ? code[i - 1]! : "";
    if (/\d/.test(char) && !/[\w$]/.test(previous) && NUMBER.test(code)) {
      push(tokens, "number", code.slice(i, NUMBER.lastIndex));
      i = NUMBER.lastIndex;
      continue;
    }
    IDENTIFIER.lastIndex = i;
    if (IDENTIFIER.test(code)) {
      const word = code.slice(i, IDENTIFIER.lastIndex);
      const key = spec.caseInsensitive ? word.toLowerCase() : word;
      push(tokens, spec.keywords.has(key) ? "keyword" : "plain", word);
      i = IDENTIFIER.lastIndex;
      continue;
    }
    push(tokens, "plain", char);
    i += 1;
  }
  return tokens;
}

/**
 * Splits `code` into coloured runs for `language`. Every character of the input ends up in exactly one
 * token, in order — markup-like text, quotes, tabs, CRLF and emoji included — so the highlighted view
 * can never show something other than what is stored. A language the highlighter does not know is not
 * an error: the code comes back as one plain token.
 */
export function highlight(code: string, language: string): Highlighted {
  const id = resolveLanguage(language);
  if (id === null) return { language: null, tokens: code ? [{ kind: "plain", text: code }] : [] };
  return { language: id, tokens: scan(code, LANGUAGES[id]) };
}
