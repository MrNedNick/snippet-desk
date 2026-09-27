export type OrganizeReason =
  | "tag-empty"
  | "tag-too-long"
  | "too-many-tags"
  | "collection-empty"
  | "collection-too-long"
  | "collection-exists"
  | "collection-not-found";

export interface OrganizeError {
  kind: "organize";
  reason: OrganizeReason;
  /** The input that was refused, as typed. */
  value: string;
}

export function organizeError(reason: OrganizeReason, value: string): OrganizeError {
  return { kind: "organize", reason, value };
}
