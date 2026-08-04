import { err, type Err } from "@/kernel";

/**
 * Typed failure a use case may return in place of a raw string.
 * `http-dispatch` maps `code`/`status` onto the JSON envelope; `cli-dispatch`
 * uses `code` to derive an exit code (query→2, command→2 by default).
 */
export type UseCaseFailure = {
  code: string;
  message: string;
  status?: number;
};

export function useCaseFailure(
  code: string,
  message: string,
  status?: number,
): Err<UseCaseFailure> {
  return err<UseCaseFailure>(
    status !== undefined ? { code, message, status } : { code, message },
  );
}

export function isUseCaseFailure(value: unknown): value is UseCaseFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as UseCaseFailure).code === "string" &&
    typeof (value as UseCaseFailure).message === "string"
  );
}

/** Extract a plain string message from a use case error (typed or raw). */
export function failureMessage(error: unknown): string {
  if (isUseCaseFailure(error)) return error.message;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
