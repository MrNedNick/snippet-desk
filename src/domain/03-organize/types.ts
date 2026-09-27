import type { CollectionId, TagId } from "../01-library/types";

export const MAX_TAG_LENGTH = 32;
export const MAX_TAGS_PER_SNIPPET = 12;
export const MAX_COLLECTION_NAME_LENGTH = 60;

/** Which part of the library is on screen: everything, one collection, the unfiled ones, and/or one tag. */
export interface LibraryFilter {
  collection: CollectionId | "unfiled" | null;
  tag: TagId | null;
}

export interface TagCount {
  tag: TagId;
  count: number;
}
