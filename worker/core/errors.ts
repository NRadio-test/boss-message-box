import type { ApiErrorCode } from "../../src/shared/contracts";

export class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly options?: {
      fieldErrors?: Record<string, string>;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "PublicError";
  }
}

export class SmsProviderRejectedError extends Error {
  constructor(message = "SMS provider rejected the request") {
    super(message);
    this.name = "SmsProviderRejectedError";
  }
}

export class DatabaseOutcomeUnknownError extends Error {
  constructor(message = "Database write outcome could not be confirmed") {
    super(message);
    this.name = "DatabaseOutcomeUnknownError";
  }
}
