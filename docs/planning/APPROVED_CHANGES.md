# 승인 반영 및 단일 도메인 검토

2026-09-15. 이 문서가 초기 PLATFORM_PLAN.md의 상충하는 내용을 대체합니다.

## 승인된 사항

- 저장소 `lily-arena/events`의 `main`에서 직접 작업. `event` 표기는 사용자 확인으로 정정.
- 새 Events D1 하나, 코드·구성만 이전. 기존 운영 데이터·키·DB는 이전하지 않음.
- Radix Primitives 기반 공통 컴포넌트. 공개 디자인 흑백, 디자인 변경은 공통 토큰/컴포넌트에서 수행.
- 공개 이벤트 주소 `events.seoularena.net/:slug`, FIRST SEAT는 `/first-seat`.
- 회사 Google Workspace 전체 계정 자동 운영자 등록. 지정 운영자 허용 목록은 사용하지 않음.
- Admin/API만 Google OIDC로 보호. `hd=seoularena.net`, 검증된 이메일 도메인·서명·issuer·audience·nonce 등을 서버 검증. 공개 참여자는 로그인 없이 접근.
- 별도 역할/타인 승인/선정 근거·점수 입력 강제 없음. 비활성 계정 접근 거부 유지.
- FIRST SEAT 투표에서도 연락처·이메일·인스타그램 수집. 운영자가 중복투표 허용 여부 설정.
- 루트에는 README와 패키지/Git 필수 설정만 유지. 계획은 docs/planning, 이관 기록은 docs/migration에 배치.

## 호스팅 요청과 사실 구분

사용자는 비상업 이벤트로 판단하여 Vercel Hobby 유지 지시. 유료 플랜 활성화 승인 없음. Vercel에 배포 가능한 구조로 구현을 진행하며 요금제를 자동 변경하지 않는다.

다만 Vercel 공식 기준은 참가비 유무만이 아니라 개인·비상업 사용인지 판단하며, 상품/서비스 홍보·유급 제작 등이 상업 이용 예시에 포함된다. 서울아레나 회사 마케팅이라는 초기 목적과 함께 보면 사용자가 무료 이벤트라고 설명했다는 사실만으로 적합성을 확정할 수 없다. 이 기록은 약관 충족이나 Vercel 예외 승인을 뜻하지 않으며, 허위 용도 기재/제한 우회는 하지 않는다.

출처: https://vercel.com/docs/limits/fair-use-guidelines

## 단일 DNS 호스트 — 사용자 승인 완료

| 항목 | 단일 호스트 권장안 | 기존 두 호스트 안 |
|---|---|---|
| 이벤트 목록 | events.seoularena.net/ | 동일 |
| FIRST SEAT | events.seoularena.net/first-seat | 동일 |
| Admin | events.seoularena.net/admin | events-admin.seoularena.net |
| 연결할 DNS 호스트 | events 1개 | events + events-admin 2개 |
| 인증 callback | https://events.seoularena.net/api/admin/auth/callback | https://events-admin.seoularena.net/api/auth/callback |
| 보안 특성 | 같은 origin. 공개 페이지 XSS가 Admin에 영향을 줄 수 있어 콘텐츠/스크립트 제한 중요 | origin 분리로 격리 유리 |
| 운영 부담 | 도메인/TLS 한 곳, 경로 라우팅 구현 필요 | 도메인/TLS 두 곳, 앱별 배포 단순 |

권장 구현: 소스는 apps/public와 apps/admin 두 앱으로 유지하되 Vercel 배포 프로젝트는 하나. Public을 `/`, Admin 빌드 결과를 `/admin/`에 배치하고 API는 `/api/events/*`와 `/api/admin/*`로 구분한다. 합쳐진 배포 결과는 빌드 시 생성하고 Git에는 넣지 않는다. Public fallback보다 `/admin`과 `/api` 경로가 우선한다. 예약 slug: admin, api, assets, auth 등. 생성 시 서버에서 검사한다.

Admin 인증 쿠키는 `Secure; HttpOnly; SameSite=Lax; Path=/api/admin`의 host-only 쿠키로 설정하고 Google callback도 이 범위에 둔다. Path는 보안 격리 경계가 아니므로 CSRF/Origin·권한 검증을 모든 관리자 API에 적용한다. `/admin` 진입 시 서버 세션 확인 후 로그인 화면/Google 이동 처리. 정적 JS는 비밀이 아니며 개인정보나 초안 내용을 포함하지 않는다. Public 페이지를 Google 로그인으로 감싸지 않는다.

공개 콘텐츠에서 raw HTML, script, SVG 업로드, 임의 iframe을 허용하지 않고 CSP로 제한한다. 관리자 데이터/원문은 no-store. 초안 미리보기는 인증된 Admin에서만. Google 로그인 경로의 returnTo는 허용된 `/admin` 상대 경로만 수용한다.

단일 호스트라 해도 Vercel 소유권 확인용 TXT가 추가로 필요할 수 있다. 따라서 'DNS 레코드 정확히 한 개'가 아니라 '연결할 서비스 호스트 한 개'다. 새로운 이벤트 생성에는 DNS/OAuth 변경이 필요 없다. 정확한 CNAME/TXT는 Vercel 프로젝트 생성 후 발급값으로 안내한다.

## 투표자 정보 기반 중복 억제 설계

### 수집과 판정

- FIRST SEAT 기본 투표 폼에 연락처·이메일·인스타그램 계정 입력 추가. 입력한 값은 실제 소유권 인증으로 간주하지 않음.
- 기본 제안: 연락처/이메일/인스타그램 중 하나라도 같은 이벤트·투표 단계·회차의 이미 접수된 투표와 일치하면 추가 투표 차단. 세 값 모두 일치하는 방식은 하나만 바꿔 우회 가능하여 권장하지 않음.
- 연락처는 기존 국내 전화 정규화 재사용. 이메일은 공백 제거·도메인 소문자화, 비교 키의 local-part 대소문자 정책은 명시하여 일관 적용. Gmail 점/plus 주소를 임의로 합치지 않음.
- 인스타그램은 앞의 @ 제거·공백 정리·대소문자 정규화 후 허용 문자/길이 검사. 계정명 입력으로 제한하고 외부 Instagram API/로그인은 도입하지 않음.
- 누군가 타인의 정보를 먼저 쓰면 정상 사용자의 투표가 차단될 수 있다. 본인인증 없는 정보 대조의 한계이며 '실제 동일인 완전 차단'으로 표현하지 않음.
- 거부 응답은 어느 값/계정이 기존 참여자인지 노출하지 않는 공통 안내.

### 저장 및 보안

- 원문은 Public Worker에서 암호화하여 `voter_private_records(event_id,voter_id,envelope,key_version,retention_until)`에 저장. Admin 단건 열람·마스킹·감사·보유기한 파기 연결.
- 동의는 투표 개인정보 동의 버전과 해당 voter/vote에 연결. 현재 응모 전용 암호문 타입/동의 FK를 그대로 재사용하면 안 됨.
- 비교는 일반 hash가 아닌 서버 비밀키 HMAC. `event_id + stage_id + round + field_kind + normalized_value`를 포함해 이벤트 간 동일인 추적 방지. HMAC도 개인정보 관련 데이터로 취급.
- `voter_identity_claims`에 event/stage/round/fieldKind/hash를 기록. 중복 금지 모드에서는 같은 범위의 유일성 제약으로 동시 요청 경쟁 차단. 투표·개인정보·동의·비교키 claim·감사·멱등 결과는 한 transaction.
- 중복 허용 모드라도 재시도/더블클릭의 동일 요청은 멱등 처리하여 한 표만 저장. 봇 방지·속도 제한은 유지.
- 중복 허용→금지 전환 시 기존 투표를 삭제/무효화하지 않고 기존 정보의 합집합을 제한 기준으로 만든다. 전환 처리 중 해당 이벤트 신규 투표를 잠그고 완료 후 재개한다. 진행 중 설정 변경의 영향은 확인창에 명시한다.
- 키 회전 시 활성 투표 회차의 중복 기준이 사라지지 않도록 해당 회차의 비교키 버전을 유지하거나 통제된 재계산을 수행한다. 과거 키를 즉시 폐기하지 않음.
- 원문 파기 시 연결 HMAC/claim/동의 처리 범위와 보유 정책을 명시. 활동 중 identity claim을 삭제하면 재투표 억제가 약해지므로 운영 문서에 설명.
- 이벤트 테스트 초기화 대상에 투표자 개인정보·투표 동의·HMAC/claim·세션·중복 제한도 포함. 다른 이벤트 데이터/제한은 보존.

## 작업 시작 상태

- 원본 9af9d71에서 169개 추적 소스/설정/테스트 파일을 허용 목록으로 복사.
- 신규 Events 저장소의 main 이력 연결. 원본 .git 이력·비밀/인증/운영 DB·배포 바인딩·원격 배포 스크립트·바이너리 자산 제외.
- 복사 파일 manifest: docs/migration/source-manifest.json.
- 아직 기존 기능을 신규 플랫폼으로 전환하거나 운영 배포하지 않았음. 단일 도메인 /admin은 사용자 승인 완료. 해당 경로를 기준으로 구현.

## 2026-09-15 첫 화면 피드백 반영 — 최신 기준

이 절은 위의 공개 목록 및 이전 시각 방향을 대체합니다.

- 공개 루트 `events.seoularena.net/`의 이벤트 목록을 폐기. 루트는 빈 404, 개별 `/:slug` 이벤트만 독립 공개. Admin `/admin` 유지. 이벤트에서 루트로 연결하는 링크 없음.
- FIRST SEAT는 검정 배경/흰색 본문 중심. 한글 Pretendard Variable, 영문 Archivo Bold, 자간 normal. 서체와 라이선스는 packages/ui/assets/fonts 및 docs/licenses에 보관.
- 공개 페이지의 eyebrow/단계 보조 레이블/섹션 번호/구분선 제거. 상단 SEOUL ARENA만 표시.
- 소개는 한 섹션, 사용자가 제공한 제목과 본문을 그대로 사용. FIRST SEAT 타이틀/기존 별도 소개 블록을 중복 표시하지 않음.
- 푸터는 개인정보 처리방침/문의 두 항목만. 검토 단계에서는 안내 창, 실제 운영 링크/정책은 공개 전 연결.
- Admin 컴포넌트 라이브러리 메뉴/화면 제거. 코드 패키지는 유지.
- Admin의 영문 보조 레이블·홍보성 설명을 제거하고 이벤트 생성/템플릿으로 생성 등 직접적인 기능명 사용.
- 공개 스타일은 공통 event-theme.css와 공개 페이지 컴포넌트에서 관리. Admin CSS가 공개 미리보기 디자인을 덮어쓰는 규칙 제거.
- 루트 404는 현재 로컬 검토 서버에서 검증. 배포용 최종 라우팅에서도 동일하게 적용해야 함.

## 2026-09-15 추가 타이포그래피 피드백 반영

- 공모·투표·결과 공통 헤더: SEOUL ARENA + 이벤트 제목(FIRST SEAT), Archivo Bold와 기본 자간.
- 본문은 영문·숫자를 포함해 Pretendard로 통일. 소개 첫 문장은 본문 크기·흰색, 설명은 회색.
- 공모 폼의 제목/설명 제거, 제출 버튼은 “문구 보내기”.
- 편집기에 모든 단계 공통 이벤트 제목, 제목 크기 H1~H4/본문, 제목·본문 색상 기본(회색)/강조(흰색) 선택 추가. 임의 CSS 대신 공통 토큰을 사용.
- 결과 주요 문구 H1, 후속 안내 H4로 시각 위계 분리. HTML 문서의 페이지 h1은 공통 이벤트 제목으로 유지.
- 타입 검사/프로덕션 빌드 통과. Chrome에서 공모·투표·결과·Admin 1440/390/320px 가로 넘침 없음. 편집 저장/복원, 모듈 추가·순서·삭제, 크기·색상 선택 및 결과 위계, 투표 설정, 템플릿 생성 검사 통과.
- 화면 검토용 구현이며 실제 접수·로그인·데이터 처리·push·배포는 아직 진행하지 않음. WAITING_FOR_REVIEW 유지.
