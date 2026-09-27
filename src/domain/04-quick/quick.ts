import { err, ok, type Result } from "../01-library/errors";
import type { Snippet, SnippetId } from "../01-library/types";
import { databaseCorruptedError, shortcutError, type DatabaseCorruptedError, type ShortcutError } from "./errors";
import {
  MAX_QUICK_RESULTS,
  MAX_RECENT,
  type Modifier,
  type PastePayload,
  type QuickResult,
  type ShortcutBinding,
  type UsageEntry,
} from "./types";

const MODIFIER_ORDER: readonly Modifier[] = ["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  commandorctrl: "CommandOrControl",
  cmdorcontrol: "CommandOrControl",
  command: "Command",
  cmd: "Command",
  control: "Control",
  ctrl: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Super",
  meta: "Super",
};

const NAMED_KEYS = ["Space", "Enter", "Tab", "Escape", "Backspace", "Delete", "Up", "Down", "Left", "Right", "Home", "End"];

function canonicalKey(raw: string): string | null {
  if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(raw)) return raw.toUpperCase();
  return NAMED_KEYS.find((key) => key.toLowerCase() === raw.toLowerCase()) ?? null;
}

/**
 * Shortcuts every app expects to keep — copy, paste, quit, close, select all, undo. Taking one globally
 * would break it in every other program. Compared after `CommandOrControl` is written out both ways.
 */
const RESERVED = new Set(
  ["C", "V", "X", "A", "Z", "Q", "W", "Tab"].flatMap((key) => [`Command+${key}`, `Control+${key}`, `CommandOrControl+${key}`]),
);

/**
 * Parses and validates an accelerator such as `Ctrl+Shift+Space` or `cmdorctrl + alt + k`. A global
 * shortcut needs at least one modifier (a bare letter would swallow typing everywhere), one key the
 * webview and the OS agree on, and must not take a shortcut other apps rely on.
 */
export function parseShortcut(raw: string): Result<ShortcutBinding, ShortcutError> {
  const parts = raw
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return err(shortcutError("shortcut-empty", raw));

  const modifiers: Modifier[] = [];
  let key: string | null = null;
  for (const [index, part] of parts.entries()) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier && index < parts.length - 1) {
      if (modifiers.includes(modifier)) return err(shortcutError("shortcut-duplicate-modifier", raw));
      modifiers.push(modifier);
      continue;
    }
    if (index !== parts.length - 1) return err(shortcutError("shortcut-unknown-key", raw));
    if (modifier) return err(shortcutError("shortcut-no-modifier", raw));
    key = canonicalKey(part);
    if (key === null) return err(shortcutError("shortcut-unknown-key", raw));
  }

  if (modifiers.length === 0 || key === null) return err(shortcutError("shortcut-no-modifier", raw));
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  const accelerator = [...modifiers, key].join("+");
  if (modifiers.length === 1 && RESERVED.has(accelerator)) return err(shortcutError("shortcut-reserved", raw));
  return ok({ accelerator, modifiers, key });
}

/** Most recent first, one entry per snippet, at most `MAX_RECENT`. Using a snippet again moves it to the top. */
export function recordUse(recent: readonly UsageEntry[], snippetId: SnippetId, usedAt: string): UsageEntry[] {
  return [{ snippetId, usedAt }, ...recent.filter((entry) => entry.snippetId !== snippetId)].slice(0, MAX_RECENT);
}

/** Drops entries for snippets that no longer exist, keeping order. */
export function pruneRecent(recent: readonly UsageEntry[], snippets: readonly Snippet[]): UsageEntry[] {
  const ids = new Set(snippets.map((snippet) => snippet.id));
  return recent.filter((entry) => ids.has(entry.snippetId));
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");
}

/**
 * How well one snippet matches every term, or 0 if any term is missing: typing more narrows the list.
 * A term at the start of the title counts most, then the start of any title word, a tag, the language,
 * and last anywhere in the code.
 */
function termScore(snippet: Snippet, term: string): number {
  const title = snippet.title.toLowerCase();
  if (title.startsWith(term)) return 8;
  if (words(snippet.title).some((word) => word.startsWith(term))) return 6;
  if (title.includes(term)) return 4;
  if (snippet.tagIds.some((tag) => tag === term || tag.startsWith(term))) return 4;
  if (snippet.language.toLowerCase() === term) return 3;
  if (snippet.code.toLowerCase().includes(term)) return 1;
  return 0;
}

/**
 * The quick search. With no query it lists recently used snippets, then the most recently edited;
 * with a query, snippets matching every term, best first, a recent use breaking ties. At most `limit`.
 */
export function quickSearch(
  snippets: readonly Snippet[],
  raw: string,
  recent: readonly UsageEntry[] = [],
  limit: number = MAX_QUICK_RESULTS,
): QuickResult[] {
  const rank = new Map(recent.map((entry, index) => [entry.snippetId, index]));
  const terms = raw.trim().toLowerCase().split(/\s+/).filter((term) => term !== "");

  const results: QuickResult[] = [];
  for (const snippet of snippets) {
    let score = 0;
    for (const term of terms) {
      const points = termScore(snippet, term);
      if (points === 0) {
        score = -1;
        break;
      }
      score += points;
    }
    if (score < 0) continue;
    results.push({ snippet, score, recentRank: rank.get(snippet.id) ?? null });
  }

  const recentOrder = (result: QuickResult) => result.recentRank ?? Number.POSITIVE_INFINITY;
  results.sort(
    (a, b) =>
      b.score - a.score ||
      recentOrder(a) - recentOrder(b) ||
      b.snippet.updatedAt.localeCompare(a.snippet.updatedAt) ||
      a.snippet.title.localeCompare(b.snippet.title),
  );
  return results.slice(0, limit);
}

/**
 * The text that goes to the clipboard: the code exactly as stored — tabs, trailing spaces, CRLF,
 * emoji, zero-width and bidi characters included. Pasting into an editor must give back what was saved.
 */
export function pastePayload(snippet: Snippet): PastePayload {
  const text = snippet.code;
  // A final line break ends the last line; it does not start another one.
  const body = text.replace(/(\r\n|\r|\n)$/, "");
  return { snippetId: snippet.id, text, lines: text === "" ? 0 : body.split(/\r\n|\r|\n/).length };
}

const CORRUPTION_MARKERS = [
  "database-corrupted",
  "database disk image is malformed",
  "file is not a database",
  "file is encrypted or is not a database",
];

/**
 * Tells a damaged library file apart from any other backend failure, from the message a Rust command
 * rejected with. Anything else stays a plain message for the caller to show.
 */
export function classifyBackendFailure(message: string): DatabaseCorruptedError | null {
  const lower = message.toLowerCase();
  return CORRUPTION_MARKERS.some((marker) => lower.includes(marker)) ? databaseCorruptedError(message) : null;
}
