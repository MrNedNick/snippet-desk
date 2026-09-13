export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export type ValidationReason =
  | "title-empty"
  | "code-empty"
  | "language-empty"
  | "query-empty";

export interface ValidationError {
  kind: "validation";
  reason: ValidationReason;
  field: string;
}

export function validationError(
  reason: ValidationReason,
  field: string,
): ValidationError {
  return { kind: "validation", reason, field };
}

export interface ClipboardUnavailableError {
  kind: "clipboard-unavailable";
  cause: string;
}

export function clipboardUnavailableError(
  cause: string,
): ClipboardUnavailableError {
  return { kind: "clipboard-unavailable", cause };
}
