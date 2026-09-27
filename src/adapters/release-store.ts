import { invoke } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../domain/01-library/errors";
import { updatesNotConfigured, type UpdatesNotConfigured } from "../domain/06-release";
import type { BackendError } from "./snippet-store";

export interface AppVersion {
  version: string;
  platform: string;
  updates: "configured" | "not-configured";
}

export type UpdateCheck =
  | { status: "upToDate"; current: string }
  | { status: "available"; current: string; version: string; notes: string; date: string | null };

export type ReleaseStoreError = UpdatesNotConfigured | BackendError;

function toError(cause: unknown): ReleaseStoreError {
  const message = String(cause);
  return message === "updates-not-configured" ? updatesNotConfigured : { kind: "backend", message };
}

async function call<T>(command: string): Promise<Result<T, ReleaseStoreError>> {
  try {
    return ok(await invoke<T>(command));
  } catch (cause) {
    return err(toError(cause));
  }
}

export const appVersionRemote = () => call<AppVersion>("app_version");
export const checkForUpdatesRemote = () => call<UpdateCheck>("check_for_updates");
/** Downloads, verifies against the built-in key, installs and restarts — it only returns on failure. */
export const installUpdateRemote = () => call<null>("install_update");
