import { invoke, isTauri } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../domain/01-library/errors";
import { classifyBackendFailure, type DatabaseCorruptedError } from "../domain/04-quick";
import {
  archiveError,
  exportFileName,
  importCancelled,
  type ArchiveError,
  type ArchiveReason,
  type BackupInfo,
  type ImportAction,
  type ImportCancelled,
  type ImportPlan,
} from "../domain/05-backup";
import type { BackendError } from "./snippet-store";

export type BackupStoreError = ArchiveError | DatabaseCorruptedError | BackendError | { kind: "import-expired" };

const ARCHIVE_REASONS: readonly ArchiveReason[] = [
  "not-json",
  "not-an-archive",
  "unsupported-version",
  "too-many-snippets",
  "invalid-snippet",
  "invalid-collection",
  "invalid-revision",
];

/** `invalid-snippet:3:code` → the domain's ArchiveError; anything else stays a backend failure. */
function toError(cause: unknown): BackupStoreError {
  const message = String(cause);
  const [reason, index, field] = message.split(":");
  if ((ARCHIVE_REASONS as readonly string[]).includes(reason!)) {
    return archiveError(reason as ArchiveReason, index === undefined ? undefined : Number(index), field);
  }
  if (message === "import-not-found") return { kind: "import-expired" };
  return classifyBackendFailure(message) ?? { kind: "backend", message };
}

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<Result<T, BackupStoreError>> {
  try {
    return ok(await invoke<T>(command, args));
  } catch (cause) {
    return err(toError(cause));
  }
}

export type ExportOutcome = { status: "saved"; path: string; snippets: number } | ImportCancelled | { status: "downloaded"; name: string };
export type StagedImport = { token: string; plan: ImportPlan };
export interface AppliedImport {
  counts: Record<ImportAction, number>;
  backup: BackupInfo;
}

/** Desktop: the save dialog, written by Rust. Browser preview: the archive is downloaded. */
export async function exportLibrary(download: (name: string, text: string) => void): Promise<Result<ExportOutcome, BackupStoreError>> {
  if (isTauri()) {
    const saved = await call<{ status: "saved"; path: string; snippets: number } | { status: "cancelled" }>("export_library");
    if (!saved.ok) return saved;
    return ok(saved.value.status === "cancelled" ? importCancelled : saved.value);
  }
  const text = await call<string>("export_library_json");
  if (!text.ok) return text;
  const name = exportFileName(new Date().toISOString());
  download(name, text.value);
  return ok({ status: "downloaded", name });
}

/**
 * Desktop: the open dialog, read by Rust. Browser preview: `pickText` shows a file input and resolves to
 * the file's text, or null when it is closed. Either way closing the picker is `cancelled`, not an error.
 */
export async function stageImport(
  pickText: () => Promise<string | null>,
): Promise<Result<StagedImport | ImportCancelled, BackupStoreError>> {
  if (isTauri()) {
    const staged = await call<({ status: "ready" } & StagedImport) | { status: "cancelled" }>("pick_import_file");
    if (!staged.ok) return staged;
    return ok(staged.value.status === "cancelled" ? importCancelled : { token: staged.value.token, plan: staged.value.plan });
  }
  const text = await pickText();
  if (text === null) return ok(importCancelled);
  const staged = await call<StagedImport>("stage_import_text", { text });
  return staged.ok ? ok({ token: staged.value.token, plan: staged.value.plan }) : staged;
}

export const applyImportRemote = (token: string) => call<AppliedImport>("apply_import", { token });
export const cancelImportRemote = (token: string) => call<null>("cancel_import", { token });
export const createBackupRemote = () => call<BackupInfo>("create_backup");
export const listBackupsRemote = () => call<BackupInfo[]>("list_backups");
/** Resolves to the backup made of the state that was replaced. */
export const restoreBackupRemote = (name: string) => call<BackupInfo>("restore_backup", { name });
