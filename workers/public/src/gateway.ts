import { DomainError } from '@first-seat/domain';
import { GATEWAY_HEADERS, verifyGatewayRequest, type GatewayIdentity } from '@first-seat/security';

/**
 * 요청이 우리 중계 서버(Vercel)에서 온 것인지 확인한다.
 *
 * 이 Worker 주소는 인터넷에 열려 있지만 서명이 없으면 아무 것도 처리하지 않는다.
 * 브라우저는 이 주소를 직접 부르지 않는다.
 *
 * 로컬 개발에서는 중계 서버 없이 Worker를 직접 부르므로 개발 모드를 둔다.
 * production에서 개발 모드가 켜져 있으면 즉시 실패한다.
 */

export interface GatewayContext {
  readonly clientIp: string;
  readonly identity: GatewayIdentity | null;
}

export interface GatewayEnv {
  readonly ENVIRONMENT: string;
  readonly GATEWAY_MODE: string;
  readonly GATEWAY_SECRET: string;
}

export async function requireGateway(
  request: Request,
  env: GatewayEnv,
  bodyText: string,
): Promise<GatewayContext> {
  if (env.GATEWAY_MODE === 'dev') {
    if (env.ENVIRONMENT === 'production') {
      throw new DomainError('FORBIDDEN', 'production에서는 개발 모드를 사용할 수 없습니다.');
    }
    // 개발에서는 Worker를 직접 부르므로 접속 IP를 그대로 쓴다.
    return { clientIp: request.headers.get('CF-Connecting-IP') ?? '', identity: null };
  }

  const verified = await verifyGatewayRequest(env.GATEWAY_SECRET, request, bodyText);
  if (!verified.ok) {
    throw new DomainError('UNAUTHENTICATED', '허용되지 않은 요청입니다.');
  }
  return { clientIp: verified.clientIp ?? '', identity: verified.identity ?? null };
}

/** 검증을 마친 요청에서 접속자 IP를 읽는다. */
export function verifiedClientIp(request: Request, context: GatewayContext): string {
  const header = request.headers.get(GATEWAY_HEADERS.clientIp);
  return context.clientIp.length > 0 ? context.clientIp : (header ?? '');
}
