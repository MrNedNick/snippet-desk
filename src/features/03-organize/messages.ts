import type { OrganizeStoreError } from "../../adapters/organize-store";
import { MAX_COLLECTION_NAME_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_PER_SNIPPET } from "../../domain/03-organize/types";

/** One sentence per refusal, saying what to do about it. */
export function organizeMessage(error: OrganizeStoreError): string {
  if (error.kind === "not-found") return "This snippet no longer exists — it may have been deleted.";
  if (error.kind === "backend") return `Couldn't save: ${error.message}`;
  switch (error.reason) {
    case "tag-empty":
      return "A tag needs at least one letter or digit.";
    case "tag-too-long":
      return `Keep each tag under ${MAX_TAG_LENGTH + 1} characters.`;
    case "too-many-tags":
      return `A snippet can have up to ${MAX_TAGS_PER_SNIPPET} tags.`;
    case "collection-empty":
      return "Give the collection a name.";
    case "collection-too-long":
      return `Keep the name under ${MAX_COLLECTION_NAME_LENGTH + 1} characters.`;
    case "collection-exists":
      return `There is already a collection called “${error.value.trim().replace(/\s+/g, " ")}”.`;
    case "collection-not-found":
      return "That collection was deleted — pick another one.";
  }
}
