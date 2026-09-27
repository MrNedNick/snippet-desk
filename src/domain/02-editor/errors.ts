import type { ValidationError } from "../01-library/errors";

export interface NoChangesError {
  kind: "no-changes";
}

export const noChangesError: NoChangesError = { kind: "no-changes" };

export type EditorError = ValidationError | NoChangesError;
