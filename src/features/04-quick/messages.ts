import type { ShortcutReason } from "../../domain/04-quick";

export const shortcutMessages: Record<ShortcutReason, string> = {
  "shortcut-empty": "Type a shortcut, for example Ctrl+Shift+Space.",
  "shortcut-no-modifier": "Add Ctrl, Alt, Shift or Cmd — a plain key would be caught in every app.",
  "shortcut-duplicate-modifier": "Each modifier only once, please.",
  "shortcut-unknown-key": "End with one key: a letter, a digit, F1–F24, Space or an arrow.",
  "shortcut-reserved": "Other apps need that one for copy, paste, undo or quit — add another modifier.",
};

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);

const SYMBOLS: Record<string, string> = IS_MAC
  ? { CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘", Space: "Space" }
  : { CommandOrControl: "Ctrl", Command: "Cmd", Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };

/** `CommandOrControl+Shift+Space` → `⌘⇧Space` on a Mac, `Ctrl+Shift+Space` elsewhere. */
export function displayShortcut(accelerator: string): string {
  const parts = accelerator.split("+").map((part) => SYMBOLS[part] ?? part);
  return IS_MAC ? parts.join("") : parts.join("+");
}

/** The in-app key that opens quick search, as the user sees it. */
export const IN_APP_KEY = IS_MAC ? "⌘K" : "Ctrl+K";
export const PASTE_KEY = IS_MAC ? "⌘V" : "Ctrl+V";
export const COPY_KEY = IS_MAC ? "⌘C" : "Ctrl+C";

/** The Rust side prefixes failures with the reason; the part after it is the OS's own words. */
export function describeShortcutFailure(message: string): string {
  const reason = message.replace(/^shortcut-unavailable:\s*/, "");
  if (reason in shortcutMessages) return shortcutMessages[reason as ShortcutReason];
  if (/desktop app/.test(reason)) return `Global shortcuts need the desktop app. Here, press ${IN_APP_KEY}.`;
  return `The system refused it — another app probably owns it (${reason}).`;
}
