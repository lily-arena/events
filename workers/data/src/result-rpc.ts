import { DomainError, type ErrorCode, type FieldError } from '@first-seat/domain';

/**
 * RPC 경계를 넘으면 예외의 타입 정보가 사라지므로 결과 객체로 전달한다.
 */
export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: ErrorCode;
      readonly message: string;
      readonly fieldErrors: readonly FieldError[];
    };

export async function toRpcResult<T>(run: () => Promise<T>): Promise<RpcResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, code: error.code, message: error.message, fieldErrors: error.fieldErrors };
    }
    throw error;
  }
}
