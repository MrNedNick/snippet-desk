import { invoke, isTauri } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../domain/01-library/errors";
import type { SnippetId } from "../domain/01-library/types";
import { classifyBackendFailure, type DatabaseCorruptedError, type UsageEntry } from "../domain/04-quick";
import type { BackendError, NotFoundError } from "./snippet-store";

export type QuickStoreError = DatabaseCorruptedError | NotFoundError | BackendError;

export interface LibraryHealth {
  status: "ok" | "damaged";
  detail: string | null;
}

export interface ShortcutStatus {
  accelerator: string;
  /** False when the OS refused it (another app owns it) or there is no desktop shell. */
  registered: boolean;
  error: string | null;
}

/** Event the desktop shell sends when the global shortcut is pressed. */
export const QUICK_SEARCH_EVENT = "quick-search-requested";

function toError(cause: unknown): QuickStoreError {
  const message = String(cause);
  if (message === "snippet-not-found") return { kind: "not-found" };
  return classifyBackendFailure(message) ?? { kind: "backend", message };
}

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<Result<T, QuickStoreError>> {
  try {
    return ok(await invoke<T>(command, args));
  } catch (cause) {
    return err(toError(cause));
  }
}

export const libraryHealthRemote = () => call<LibraryHealth>("library_health");
/** Keeps the damaged file under a new name, starts an empty library; resolves to the name it was kept under. */
export const setAsideDamagedLibraryRemote = () => call<string>("set_aside_damaged_library");
export const listRecentUsesRemote = () => call<UsageEntry[]>("list_recent_uses");
export const recordSnippetUseRemote = (id: SnippetId) => call<UsageEntry[]>("record_snippet_use", { id });
export const getQuickShortcutRemote = () => call<ShortcutStatus>("get_quick_shortcut");
export const setQuickShortcutRemote = (accelerator: string) => call<ShortcutStatus>("set_quick_shortcut", { accelerator });

/** Calls `handler` whenever the global shortcut is pressed. Resolves to an unsubscribe function. */
export async function onQuickSearchRequested(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen(QUICK_SEARCH_EVENT, handler);
}

/**
 * After a snippet is copied from a quick search the global shortcut opened, the window steps aside so
 * the editor underneath gets focus back and ⌘V / Ctrl+V pastes straight into it.
 */
export async function stepAside(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}
