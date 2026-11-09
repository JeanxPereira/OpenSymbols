export class DecodeError extends Error {
  constructor(
    readonly where: string,
    message: string,
  ) {
    super(message);
    this.name = "DecodeError";
  }
}
