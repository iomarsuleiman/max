import type { ErrorCode, SerializedError } from "@/lib/domain/errors";

export class OpError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;
  constructor(e: SerializedError) {
    super(e.message);
    this.name = "OpError";
    this.code = e.code;
    this.details = e.details;
  }
}

export function toOpError(err: unknown): OpError {
  if (err instanceof OpError) return err;
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "code" in data && "message" in data) return new OpError(data as SerializedError);
  if (err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    return new OpError({ code: "INTERNAL", message: "You're offline or Max can't be reached. Your changes are kept on this device; Max will retry when you're back online." });
  }
  return new OpError({ code: "INTERNAL", message: "Something interrupted that request. Try again in a moment." });
}
