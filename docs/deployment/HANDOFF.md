# Events 도메인·회사 로그인 연결 안내

기준: 2026-09-15. DNS와 Google OAuth는 담당자가 추후 연결한다. 기존 FIRST SEAT 서비스에는 변경하지 않는다.

## 사용할 주소

| 용도 | 주소 |
|---|---|
| FIRST SEAT | https://events.seoularena.net/first-seat |
| 다른 이벤트 | https://events.seoularena.net/이벤트주소 |
| 관리자 | https://events.seoularena.net/admin |
| Google 로그인 콜백 | https://events.seoularena.net/api/admin/auth/callback |

루트 `/`는 공개 이벤트 목록 없이 404를 반환한다. `events-admin.seoularena.net`은 사용하지 않는다. 이벤트가 늘어나도 DNS를 추가하지 않는다.

## DNS 담당자에게 전달할 내용

서울아레나 Events 서비스를 위해 **events.seoularena.net 한 호스트**를 신규 Vercel 프로젝트에 연결하려고 합니다.

- Vercel 팀: `seoul-arena`
- 프로젝트: `seoularena-events`
- 프로젝트 ID: `prj_DUDO44qmR2cqIR6HyjoK0etiRlj7`
- 임시 배포 주소: https://seoularena-events.vercel.app
- 등록할 레코드 종류: **CNAME**
- 호스트/이름: **events**
- 대상: **Vercel 프로젝트 Settings → Domains에 events.seoularena.net을 추가한 뒤 표시되는 프로젝트 전용 값을 사용**
- TTL: 자동 또는 회사 기본값
- Cloudflare DNS 프록시: 최초 연결 검증은 DNS only로 진행
- 기존 `events` 레코드가 있다면 현재 사용처부터 확인하고 충돌을 해결
- 도메인 소유 확인이 요구될 경우 Vercel이 표시하는 **TXT 이름과 값**도 등록
- 다른 호스트, 기존 FIRST SEAT 레코드 및 네임서버는 변경하지 않음

**현재 확인되지 않은 값:** CNAME 대상과 소유 확인 TXT. 계정에서 도메인 연결을 시도했으나 `403 domain_not_owned`로 연결되지 않아 프로젝트 전용 레코드를 발급·검증하지 못했다. 임의의 공통 CNAME이나 TXT 값을 전달하지 않는다. 도메인 권한이 있는 담당자가 Vercel에서 추가하고 표시된 값을 확정해야 한다. 도메인 구매·이전은 필요하지 않다.

현재 조회된 네임서버는 `stella.ns.cloudflare.com`, `adam.ns.cloudflare.com`이다. 조회만 했으며 DNS를 수정하지 않았다.

참고: [Vercel 도메인 연결](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [소유권 확인](https://vercel.com/docs/domains/working-with-domains/claim-domain-ownership). CNAME 하나가 기본이며 소유 확인 TXT가 추가될 수 있다.

## Google Workspace / Google Cloud 담당자

회사에서 관리하는 Google Cloud 프로젝트에 Events용 OAuth 클라이언트를 새로 만든다. 기존 FIRST SEAT 클라이언트 비밀값을 복사하지 않는다.

| 항목 | 설정 |
|---|---|
| 앱 이름 | Seoul Arena Events |
| 사용자 대상 | 회사 Workspace 조직 내부 |
| 클라이언트 유형 | 웹 애플리케이션 |
| 승인된 JavaScript 원본 | https://events.seoularena.net |
| 승인된 리디렉션 URI | https://events.seoularena.net/api/admin/auth/callback |
| 요청 범위 | openid, email, profile |

서버 방식 로그인이므로 JavaScript 원본은 브라우저 SDK용 필수 항목은 아니지만 위 주소로 통일한다. 리디렉션 URI는 경로까지 정확히 등록한다. 임시 Vercel 주소나 workers.dev 주소를 Google 콜백으로 등록하지 않는다.

발급 후 Vercel 프로젝트의 Production 환경변수에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 등록하고 재배포한다. 비밀값은 채팅·문서·Git에 넣지 않는다.

로그인은 Google이 검증한 이메일 및 조직 정보가 `seoularena.net`인 경우만 허용한다. 해당 회사 계정은 최초 로그인 시 자동 운영자로 등록되며 전체 이벤트를 관리한다. 공개 참여 페이지에는 로그인 제한을 적용하지 않는다.

## 나머지 배포 설정

Vercel Production:

| 환경변수 | 값 |
|---|---|
| PUBLIC_ORIGIN | https://events.seoularena.net |
| ADMIN_WORKER_URL | https://seoularena-events-admin.lily-arena.workers.dev |
| PUBLIC_WORKER_URL | https://seoularena-events-public.lily-arena.workers.dev |
| SESSION_SECRET | 신규 Events 전용 생성값 |
| GATEWAY_SECRET | 신규 Workers와 동일한 신규 서명값 |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | 위에서 발급한 값 |

Cloudflare 키 등록 대상은 [KEY_REGISTRATION.md](KEY_REGISTRATION.md)에 정리했다. 신규 키 원격 등록은 별도 승인 대기 상태다.

봇 방지: Cloudflare Turnstile 사이트를 만들고 허용 호스트를 `events.seoularena.net`으로 설정한다. 공개 Worker의 `TURNSTILE_SITE_KEY`와 비밀값 `TURNSTILE_SECRET`을 등록한다. 운영에서는 로컬 모의 인증을 사용하지 않는다.

신규 D1: `seoularena-events`, ID `88de451a-a805-46be-b58c-486ec95c1ee7`. 기존 D1은 사용하지 않는다. Workers는 `seoularena-events-data`, `seoularena-events-admin`, `seoularena-events-public`이다. Data Worker에는 공개 workers.dev 주소가 없다.

## 연결 후 확인 순서

1. DNS 연결·HTTPS 인증서 발급 확인.
2. 배포 환경변수·신규 키·Turnstile 등록 후 재배포.
3. 회사 계정 로그인과 회사 외 계정 차단 확인.
4. FIRST SEAT 초안의 동의문 원문·개인정보 처리방침·문의·일정 확인.
5. 별도의 테스트 이벤트에서 접수·심사·투표·결과·초기화 확인.
6. FIRST SEAT 공개 및 접수 시작. 실제 운영 데이터 초기화는 하지 않음.

현재 FIRST SEAT는 구성만 등록한 초안이며 참여 데이터는 이전하지 않았다. DNS, 실제 회사 로그인, 운영 참여 흐름은 아직 연결 완료로 간주하지 않는다. Vercel Hobby를 유지하며 유료 플랜은 활성화하지 않았다. 회사 마케팅 용도가 Hobby 약관에 부합하는지는 이벤트의 무료 참여 여부만으로 확정되지 않으며 기존 계획의 약관 검토 사항은 유지한다.

## 2026-09-15 연결 상태 갱신

담당자 설정 이후 Cloudflare 공용 DNS에서 `events.seoularena.net` CNAME → `e01a0bf62b217017.vercel-dns-017.com`을 확인했다(TTL 300초). Vercel 배포 도메인 연결 및 해당 호스트의 HTTPS `/admin` 200 응답도 확인했다. 위의 이전 미확정 기록은 초기 상태이며 CNAME은 이제 확인되었다. 일부 로컬 DNS에서는 아직 주소가 조회되지 않아 캐시 차이가 관찰된다. TXT의 실제 등록값은 조회·검증하지 않았다.

관리자 API의 Vercel 404는 `api/gateway.ts`와 명시적 `/api/:path*` 경로 연결로 수정하고 재배포했다. 배포 ID: `dpl_Cpw78Q7pHfRMEYxb3qco31jUKL7Z`. 이후 `/api/admin/session`은 애플리케이션의 503 NOT_CONFIGURED 응답을 반환한다. 이는 DNS 오류가 아니라 아직 필요한 서비스 환경변수가 배포에 없는 상태다. 신규 키 등록 승인은 여전히 별도 대기 중이다.

## 2026-09-15 서비스 키 등록 완료

사용자가 "그래 등록해"로 승인하여 신규 Events 키를 KEY_REGISTRATION.md의 대상에 등록했다. Vercel Production에 서비스 키 2개와 PUBLIC_ORIGIN·ADMIN_WORKER_URL·PUBLIC_WORKER_URL을 등록했다. 담당자가 등록한 GOOGLE_CLIENT_ID·GOOGLE_CLIENT_SECRET의 존재를 확인하고 보존했다. 비밀값은 출력하거나 저장소에 추가하지 않았다. 실제 회사 계정으로 로그인 완료까지의 확인은 별도로 필요하다.

키 적용 배포: `dpl_BniLEHVQbiVA6hQ43xHrBkkzyUrx`. Chrome에서 관리자 화면 오류 없음, 미로그인 세션 요청 401, 로그인 요청 303 및 Google 이동을 확인했다. 콜백은 `https://events.seoularena.net/api/admin/auth/callback`, 조직 안내 값은 `seoularena.net`, 범위는 `openid email profile`로 확인했다. Google 계정 선택 이후 실제 조직 로그인·운영자 등록 완료는 사용자 확인이 필요하다.

## 관리자 진입 동작

2026-09-15 요청에 따라 `/admin`에서 세션이 없으면 중간 로그인 안내 화면 없이 Google 로그인으로 자동 이동하도록 변경했다. 서버 연결 실패 등 401 이외 오류는 자동 로그인 반복을 유발하지 않고 오류 안내를 유지한다. 이미 로그인한 사용자는 관리자 화면으로 진입한다.

## 실제 참여 테스트의 남은 연결

2026-09-15 공개 Worker Secrets 이름 조회에서 TURNSTILE_SECRET 미등록을 확인했다. 허용 호스트 events.seoularena.net인 Turnstile 사이트의 사이트 키를 공개 Worker 구성 TURNSTILE_SITE_KEY에, 비밀 키를 TURNSTILE_SECRET에 등록해야 한다. 사이트 키는 workers/public/wrangler.production.jsonc에도 반영해 이후 배포 시 보존한다. 기존 인증·암호화 키는 등록 완료 상태다. 실제 공개 페이지의 봇 검증을 모의 검증으로 우회하지 않는다.

로컬 /admin 및 /이벤트주소는 실제 로컬 D1/Workers에 연결하는 모드를 기본으로 변경했다. 디자인 전용 모드는 ?design으로만 연다. 에디터 안의 미리보기는 참여 데이터 저장 화면이 아니며 ‘공개 페이지에서 테스트’로 실제 페이지를 연다. 초기화는 실제 API에 연결되며 범위 확인·최종 확인 후 해당 이벤트 데이터만 삭제한다.

## 2026-09-15 Turnstile 운영 연결 완료

회사 Cloudflare 계정에 Events 전용 위젯 `Seoul Arena Events`를 신규 생성했다. 사이트 키는 `0x4AAAAAAE16fT3HsHlEPiFR`, 허용 도메인은 `events.seoularena.net`, 모드는 invisible이다. 신규 공개 Worker의 TURNSTILE_SECRET에 비밀 키를 등록했고 사이트 키는 배포 구성에 저장했다. 기존 FIRST SEAT 위젯은 변경하지 않았다. 비밀 키는 Git에서 제외했다.

실제 도메인에서 위젯 실행을 확인했으나 자동 Chrome은 Cloudflare 오류 600010(봇 행동 탐지)로 차단됐다. 검증을 우회하지 않았으며 일반 브라우저에서 최종 참여 확인을 요청했다. [Cloudflare 오류 코드 문서](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/) 참고.

별도 검증 이벤트: https://events.seoularena.net/ops-check-1789471771518 . 가상 정보만 입력하며 검증 완료 후 보관한다. FIRST SEAT는 페이지 공개/공모/접수 중지 상태임을 확인했다. 접수 개시는 운영자가 공개·일정에서 공모 전환을 확인해 실행한다. 회사 Google 계정 자동 등록 1건을 확인했다(개인정보 미조회).

위젯은 공식 API로 생성했으며 [위젯 관리 문서](https://developers.cloudflare.com/turnstile/get-started/widget-management/api/)를 참고했다. Invisible 모드 사용 조건에 따라 공개 페이지 개인정보 처리방침 창에 [Cloudflare Turnstile 개인정보 처리 안내](https://www.cloudflare.com/turnstile-privacy-policy/) 링크를 포함했다.
