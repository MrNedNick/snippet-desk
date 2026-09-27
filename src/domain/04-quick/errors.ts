export type ShortcutReason =
  | "shortcut-empty"
  | "shortcut-no-modifier"
  | "shortcut-duplicate-modifier"
  | "shortcut-unknown-key"
  | "shortcut-reserved";

export interface ShortcutError {
  kind: "shortcut";
  reason: ShortcutReason;
  /** The accelerator as typed. */
  value: string;
}

export function shortcutError(reason: ShortcutReason, value: string): ShortcutError {
  return { kind: "shortcut", reason, value };
}

/**
 * The library file exists but SQLite cannot read it (a truncated copy, a disk error, another program
 * writing to it). Different from a plain backend failure: retrying will not help, and the UI must offer
 * to set the damaged file aside instead of pretending the library is empty.
 */
export interface DatabaseCorruptedError {
  kind: "database-corrupted";
  detail: string;
}

export function databaseCorruptedError(detail: string): DatabaseCorruptedError {
  return { kind: "database-corrupted", detail };
}
