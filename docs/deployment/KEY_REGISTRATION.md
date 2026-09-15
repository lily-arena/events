# 신규 Events 서비스 키 등록 범위

새로 생성한 Events 전용 키만 아래 서비스의 비밀값 저장소에 등록한다. 기존 FIRST SEAT 키·인증 파일은 사용하지 않는다. 값은 문서·Git·채팅에 기록하지 않는다.

| 대상 | 계정 / 프로젝트 | 등록할 환경변수 | 목적 |
|---|---|---|---|
| Cloudflare 관리자 Worker | seoularena-events-admin / 현재 회사 계정 | PII_PRIVATE_KEY, GATEWAY_SECRET | 인증된 관리자 개인정보 복호화, Vercel 중계 서명 확인 |
| Cloudflare 공개 Worker | seoularena-events-public / 같은 계정 | PII_PUBLIC_KEY, IDENTITY_HMAC_KEY, GATEWAY_SECRET | 참여자 개인정보 암호화, 이벤트별 중복 대조, 중계 서명 확인 |
| Vercel | seoul-arena / seoularena-events (prj_DUDO44qmR2cqIR6HyjoK0etiRlj7) | SESSION_SECRET, GATEWAY_SECRET | 관리자 세션 서명, 신규 Workers와의 통신 인증 |

- 비밀값은 Cloudflare Workers Secrets / Vercel 환경변수에 저장한다.
- 공개 Worker 및 브라우저에는 개인정보 복호화용 개인키를 주지 않는다.
- Data Worker는 암호문을 저장하며 개인키를 가지지 않는다.
- Google OAuth 클라이언트 ID/비밀값 및 DNS 연결은 사용자 지시대로 추후 별도 설정한다.
- 2026-09-15 사용자의 명시적 승인 후 위 Cloudflare·Vercel 대상에 신규 키 등록을 완료했다. 값은 Git·문서·출력에 포함하지 않았다.
- 이 등록은 유료 플랜 활성화, 기존 서비스 변경, 데이터 이전을 포함하지 않는다.
