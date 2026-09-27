import type { Snippet, SnippetId } from "../01-library/types";

/** What opens the quick search from anywhere in the system. */
export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
/** How many recently used snippets are remembered. */
export const MAX_RECENT = 20;
/** How many results the quick search shows: it is for picking, not browsing. */
export const MAX_QUICK_RESULTS = 8;

export type Modifier = "CommandOrControl" | "Command" | "Control" | "Alt" | "Shift" | "Super";

/** A global shortcut in the accelerator syntax Tauri registers, split into its parts. */
export interface ShortcutBinding {
  /** Canonical spelling, modifiers in a fixed order: `CommandOrControl+Shift+Space`. */
  accelerator: string;
  modifiers: Modifier[];
  key: string;
}

/** One time a snippet was copied from the quick search. */
export interface UsageEntry {
  snippetId: SnippetId;
  usedAt: string;
}

export interface QuickResult {
  snippet: Snippet;
  score: number;
  /** Position in the recent list (0 = last used), or null if it was not used lately. */
  recentRank: number | null;
}

/** The exact text that goes to the clipboard, and what the UI says about it. */
export interface PastePayload {
  snippetId: SnippetId;
  text: string;
  /** Lines of code copied, for "Copied 12 lines". */
  lines: number;
}
