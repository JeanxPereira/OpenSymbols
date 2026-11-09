import { DecodeError } from "@opensymbols/decode";

/** `where: message` for a DecodeError, else the error's message. */
export function describeError(e: unknown): string {
  if (e instanceof DecodeError) return `${e.where}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
