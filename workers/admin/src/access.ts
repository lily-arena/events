import { DomainError } from '@first-seat/domain';
import { verifyGatewayRequest, type GatewayIdentity } from '@first-seat/security';
import type { AdminEnv } from './env.js';

/**
 * 운영자 신원 확인.
 *
 * 회사 계정 로그인(Google Workspace)은 Vercel 중계 서버가 처리한다.
 * 이 Worker는 그 서버가 서명해 보낸 신원만 받아들이고, 브라우저가 직접 보낸 값은 쓰지 않는다.
 * 서명이 없거나 맞지 않으면 어떤 요청도 처리하지 않는다.
 *
 * 로컬 개발에서는 중계 서버 없이 Worker를 직접 부르므로 개발 모드를 둔다.
 * production에서 개발 모드가 켜져 있으면 즉시 실패한다.
 */

/** 허용 도메인은 정확히 seoularena.net이다. 유사 도메인과 외부 계정은 거절한다. */
const COMPANY_DOMAIN = 'seoularena.net';

export function requireCompanyDomain(email: string): void {
  const at = email.lastIndexOf('@');
  if (at < 0) throw new DomainError('FORBIDDEN', '회사 계정으로 로그인해주세요.');
  const domain = email.slice(at + 1).toLowerCase();
  if (domain !== COMPANY_DOMAIN) {
    throw new DomainError('FORBIDDEN', '서울아레나 회사 계정만 사용할 수 있습니다.');
  }
}

export interface AccessIdentity {
  /** 인증 제공자. 같은 사람을 이메일이 아니라 provider+subject로 식별한다. */
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
}

/**
 * 개발 mock. production에서 켜지면 즉시 실패한다.
 * 실제 회사 로그인 검증을 대신하지 않는다.
 */
function mockIdentity(request: Request, env: AdminEnv): AccessIdentity {
  if (env.ENVIRONMENT === 'production') {
    throw new DomainError('FORBIDDEN', 'production에서는 개발 모드를 사용할 수 없습니다.');
  }
  const subject = request.headers.get('X-Dev-Access-Subject');
  if (subject === null || subject.length === 0) {
    throw new DomainError('UNAUTHENTICATED', '개발용 인증 헤더가 없습니다.');
  }
  const email = request.headers.get('X-Dev-Access-Email') ?? `${subject}@seoularena.net`;
  // 로컬에서도 실제와 같은 도메인 검사를 거친다.
  requireCompanyDomain(email);
  return { provider: 'dev', subject, email };
}

export interface AuthenticatedRequest {
  readonly identity: AccessIdentity;
  readonly clientIp: string;
}

export async function authenticate(
  request: Request,
  env: AdminEnv,
  bodyText: string,
): Promise<AuthenticatedRequest> {
  if (env.GATEWAY_MODE === 'dev') {
    return { identity: mockIdentity(request, env), clientIp: request.headers.get('CF-Connecting-IP') ?? '' };
  }

  const verified = await verifyGatewayRequest(env.GATEWAY_SECRET, request, bodyText);
  if (!verified.ok) throw new DomainError('UNAUTHENTICATED', '허용되지 않은 요청입니다.');

  const identity: GatewayIdentity | null = verified.identity ?? null;
  if (identity === null || identity.subject.length === 0) {
    throw new DomainError('UNAUTHENTICATED', '로그인이 필요합니다.');
  }
  // 중계 서버가 이미 확인했지만 여기서도 다시 본다. 한쪽 설정이 잘못돼도 외부 계정이 들어오지 않게 한다.
  requireCompanyDomain(identity.email);
  return {
    identity: { provider: identity.provider, subject: identity.subject, email: identity.email },
    clientIp: verified.clientIp ?? '',
  };
}
