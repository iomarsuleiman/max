export type ErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "LIMIT"
  | "CONFIRMATION_REQUIRED"
  | "READ_ONLY"
  | "INTERNAL";

/** A structured, user-presentable error. Messages say what happened and how to recover. */
export class MaxError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MaxError";
  }
}

export interface SerializedError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof MaxError) return { code: err.code, message: err.message, details: err.details };
  // Convex wraps thrown errors; recover our payload when present.
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "code" in data && "message" in data) {
    return data as SerializedError;
  }
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed?.code && parsed?.message) return parsed as SerializedError;
    } catch {
      /* not JSON */
    }
  }
  return { code: "INTERNAL", message: "Max couldn't finish that request. Try again in a moment." };
}

export const notFound = (what = "page") =>
  new MaxError("NOT_FOUND", `This ${what} doesn't exist or was permanently deleted.`);
