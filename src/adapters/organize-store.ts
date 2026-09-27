import { invoke } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../domain/01-library/errors";
import type { Collection, CollectionId, Snippet, TagId } from "../domain/01-library/types";
import { organizeError, type OrganizeError, type OrganizeReason } from "../domain/03-organize/errors";
import type { BackendError, NotFoundError } from "./snippet-store";

const REASONS: readonly OrganizeReason[] = [
  "tag-empty",
  "tag-too-long",
  "too-many-tags",
  "collection-empty",
  "collection-too-long",
  "collection-exists",
  "collection-not-found",
];

export type OrganizeStoreError = OrganizeError | NotFoundError | BackendError;

/** The Rust side answers with a reason string; known ones come back as the domain's own errors. */
function toError(cause: unknown, value = ""): OrganizeStoreError {
  const reason = String(cause);
  if (reason === "snippet-not-found") return { kind: "not-found" };
  if ((REASONS as readonly string[]).includes(reason)) return organizeError(reason as OrganizeReason, value);
  return { kind: "backend", message: reason };
}

async function call<T>(command: string, args: Record<string, unknown>, value = ""): Promise<Result<T, OrganizeStoreError>> {
  try {
    return ok(await invoke<T>(command, args));
  } catch (cause) {
    return err(toError(cause, value));
  }
}

export const setTagsRemote = (id: string, tags: TagId[]) =>
  call<Snippet>("set_snippet_tags", { id, tags }, tags.join(", "));

export const setCollectionRemote = (id: string, collectionId: CollectionId | null) =>
  call<Snippet>("set_snippet_collection", { id, collectionId });

export const listCollectionsRemote = () => call<Collection[]>("list_collections", {});

export const createCollectionRemote = (name: string) => call<Collection>("create_collection", { name }, name);

export const renameCollectionRemote = (id: string, name: string) =>
  call<Collection>("rename_collection", { id, name }, name);

export const deleteCollectionRemote = (id: string) => call<null>("delete_collection", { id });
