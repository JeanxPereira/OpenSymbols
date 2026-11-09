import { DecodeError } from "@opensymbols/decode";

/** `where: message` for a DecodeError, else the error's message. */
export function describeError(e: unknown): string {
  if (e instanceof DecodeError) return `${e.where}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

/** A CLI failure caused by bad input or usage (exit code 2), not a decode bug. */
export class UsageError extends Error {}

/** A symbol that cannot be encoded for the runtime; `generate` skips it and reports the reason. */
export class EncodeError extends Error {
  constructor(
    readonly symbol: string,
    message: string,
  ) {
    super(message);
    this.name = "EncodeError";
  }
}
