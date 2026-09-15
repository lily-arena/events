/*
 * 참고: 아래는 패키지 이름(@first-seat/...)이 아니라 상대 경로로 가져온다.
 * Vercel Edge 번들러가 워크스페이스 패키지의 TypeScript 원본을 해석하지 못해
 * 배포가 실패하기 때문이다. 코드를 복사하지 않고 같은 원본을 그대로 쓴다.
 */
import { jsonError, relayRequest } from '../../../packages/relay/src/index.js';

/**
 * 참여자 API 중계.
 *
 * 브라우저는 이 화면 주소의 /api만 부른다. 쿠키가 같은 출처로 오가므로
 * 회사 DNS에는 화면 주소 하나만 추가하면 된다.
 * 실제 처리는 Cloudflare Worker가 하고 여기서는 전달만 한다.
 */
export const config = { runtime: 'edge' };

export default async function handler(request: Request): Promise<Response> {
  const secret = process.env['GATEWAY_SECRET'];
  const upstream = process.env['PUBLIC_API_URL'];
  if (secret === undefined || upstream === undefined) {
    return jsonError(500, 'UNAVAILABLE', '서버 설정이 완료되지 않았습니다.');
  }
  return relayRequest(request, { upstreamBase: upstream, secret, identity: null });
}
