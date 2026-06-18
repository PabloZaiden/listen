export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly errorCode?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
