export class DomainError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (message: string) => new DomainError(404, "not_found", message);
export const unauthorized = (message: string) => new DomainError(401, "unauthorized", message);
export const conflict = (message: string, details?: unknown) => new DomainError(409, "conflict", message, details);
export const invalid = (message: string, details?: unknown) => new DomainError(422, "invalid_operation", message, details);
