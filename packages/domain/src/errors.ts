/** OpenAPI 계약의 오류 코드. UI는 requestId만 문의에 사용하고 입력값을 로그로 보내지 않는다. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_FAILED'
  | 'CHALLENGE_FAILED'
  | 'CONFLICT'
  | 'DUPLICATE_KEY'
  | 'ALREADY_VOTED'
  | 'CONFIG_CHANGED'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'NOT_FOUND'
  | 'SUBMISSION_GATE';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export interface ErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly fieldErrors?: readonly FieldError[];
}

export const STATUS_FOR_CODE: Readonly<Record<ErrorCode, number>> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_FAILED: 403,
  CHALLENGE_FAILED: 403,
  CONFLICT: 409,
  DUPLICATE_KEY: 409,
  ALREADY_VOTED: 409,
  CONFIG_CHANGED: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
  NOT_FOUND: 404,
  SUBMISSION_GATE: 409,
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly fieldErrors: readonly FieldError[];
  constructor(code: ErrorCode, message: string, fieldErrors: readonly FieldError[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
  get status(): number {
    return STATUS_FOR_CODE[this.code];
  }
}
