# Seoul Arena Events

이벤트 페이지를 만들고 공모·투표·결과를 운영하는 서울아레나 플랫폼입니다.
공개 주소는 `events.seoularena.net/:slug`, 관리자는 같은 도메인의 `/admin`입니다. 공개 이벤트 목록과 루트 페이지는 제공하지 않습니다.

## 구조

| 폴더 | 역할 |
|---|---|
| apps/platform | 공개 앱과 Admin의 배포 진입점 |
| apps/public/src/events | 참여자 공모·투표·결과 화면 |
| apps/admin/src/events | 이벤트 빌더·심사·운영·개인정보 관리 |
| apps/preview | 로컬 검토 화면 진입점 |
| packages/ui | Radix 공통 컴포넌트·폰트·디자인 토큰 |
| packages/event-builder | 템플릿·모듈·입력 항목·설정 검증 |
| packages/security | 암호화·서명·마스킹·중복 대조 |
| packages/relay | Google 로그인과 Vercel 중계 |
| workers/public/src/events | 공개 요청 검증·개인정보 암호화 |
| workers/admin/src/events | 관리자 인증 경계·개인정보 복호화 |
| workers/data/src/events | 이벤트별 저장·단계·심사·투표·감사·파기 |
| migrations/events | 신규 Events D1 전용 스키마·초기 구성 |
| api | Vercel API 진입점 |
| config | 빌드·타입·테스트 설정 |
| scripts | 개발·설정 도구 |
| seed | 개인정보 없는 FIRST SEAT 초기 구성 |
| tests/platform | 로컬 통합·브라우저 검증 |
| docs | 계획·이전 근거·검증·배포·운영 문서 |

FIRST SEAT에서 재사용한 기존 도메인·보안·콘텐츠 코드와 참고 테스트는 별도 패키지에 남아 있습니다. 활성 배포는 위의 Events 진입점만 사용합니다. 루트 `migrations/000*.sql`은 기존 FIRST SEAT 참고 자료이며 신규 DB에 적용하지 않습니다.

## 로컬 개발

Node.js 24를 사용합니다.

1. `npm ci`
2. 최초 한 번 `npm run dev:keys` — 새 로컬 키 생성, 기존 파일 덮어쓰기 거부
3. `npm run db:migrate:local` — 신규 로컬 DB에만 적용
4. 별도 터미널에서 `npm run dev:api`, `npm run dev:public-api`, `npm run dev` 실행
5. `http://127.0.0.1:5190/admin?connected`에서 로컬 DB에 연결한 Admin 확인

`/admin` 및 `/first-seat`는 별도의 디자인 검토 모드이며 실제 참여 데이터를 저장하지 않습니다. `?connected`는 로컬 개발 진입점에서만 사용합니다. 실제 배포에는 검토 모드를 넣지 않습니다.

최초 FIRST SEAT는 초안입니다. 개인정보 처리방침·동의문·문의 채널을 확인한 뒤 페이지 공개와 접수 시작을 진행합니다. 운영 데이터 이전은 없습니다.

## 검증

- `npm run typecheck`
- `npm test`
- `npm run test:events`
- `npm run test:integration` — 로컬 API 실행 필요, 가상 이벤트만 사용
- `npm run test:browser` — 로컬 API와 화면 실행 필요, 설치된 Chrome 사용
- `npm run build`

## 운영 연결

[DNS·Google 연결 안내](docs/deployment/HANDOFF.md)와 [운영 방법](docs/operations/OPERATIONS.md)을 참고하세요.
새 D1 하나와 독립 Workers/Vercel 프로젝트를 사용합니다. 기존 FIRST SEAT 서비스·저장소·DB·키는 변경하거나 이전하지 않습니다.

비밀값·로컬 DB·참여 데이터·빌드 결과·검증 화면은 Git에서 제외합니다. 최초 원격 스키마의 트리거는 Cloudflare SQL 파일 가져오기로 적용하고 `d1_migrations`에 적용 이력을 기록했습니다. 이후 migrations는 해당 이력을 기준으로 적용합니다.
