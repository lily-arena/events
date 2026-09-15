/*
 * 참고: 아래는 패키지 이름(@first-seat/...)이 아니라 상대 경로로 가져온다.
 * Vercel Edge 번들러가 워크스페이스 패키지의 TypeScript 원본을 해석하지 못해
 * 배포가 실패하기 때문이다. 코드를 복사하지 않고 같은 원본을 그대로 쓴다.
 */
import { jsonError, readSessionValue, relayRequest } from '../../../packages/relay/src/index.js';
import { ADMIN_SESSION_COOKIE, readCookie } from '../src/server/cookies.js';

/**
 * 운영 API 중계.
 *
 * 로그인하지 않았으면 Cloudflare로 보내지 않고 여기서 끊는다.
 * 로그인했으면 이 서버가 확인한 신원을 서명해 함께 보낸다.
 * 브라우저가 신원 헤더를 직접 넣어도 중계 과정에서 지워진다.
 */
export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const secret = process.env['GATEWAY_SECRET'];
  const upstream = process.env['ADMIN_API_URL'];
  const sessionSecret = process.env['SESSION_SECRET'];
  if (secret === undefined || upstream === undefined || sessionSecret === undefined) {
    return jsonError(500, 'UNAVAILABLE', '서버 설정이 완료되지 않았습니다.');
  }

  if (!process.env['GOOGLE_CLIENT_ID']?.trim() || !process.env['GOOGLE_CLIENT_SECRET']?.trim()) {
    return jsonError(503, 'UNAVAILABLE', '회사 계정 로그인 설정이 아직 완료되지 않았습니다. 운영 담당자에게 문의해주세요.');
  }

  const identity = await readSessionValue(sessionSecret, readCookie(request, ADMIN_SESSION_COOKIE));
  if (identity === null) {
    return jsonError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  }

  return relayRequest(request, { upstreamBase: upstream, secret, identity });
}
