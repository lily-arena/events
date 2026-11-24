# P011 Events 인계 — 2026-11-24

## 코드와 현재 운영

- 저장소: https://github.com/lily-arena/events (현재 공개)
- 원본 코드 SHA: `59f10a5188592465645ba32d14e93c22f36960ce`
- 인계 브랜치: `handoff/p011-20261124`
- 운영: https://events.seoularena.net, Vercel 프로젝트 `seoularena-events`
- `/`: 이벤트 목록, `/:slug`: 이벤트 페이지, `/admin` 및 `/admin/*`: 관리자
- `/api/events/catalog/list`: 티저용 공개 목록. `/api/events/:slug`, `/api/events/:slug/assets/:id`: 공개 이벤트/이미지. 참여·상태·투표는 같은 이벤트 아래 API. `/api/admin/*`: Google 세션 필요.
- Google 콜백: `https://events.seoularena.net/api/admin/auth/callback`. 기존 설정 유지. `dev.kakaoarena-seoul.com` 회사 SSO는 변경하지 않습니다.

## 실행·빌드·테스트

```sh
git clone --branch handoff/p011-20261124 https://github.com/lily-arena/events.git
cd events
npm ci
npm run build
npm run typecheck
npm test
npm run test:events
# 개발용 빈 DB와 가상 데이터만 사용
npm run dev:keys
npm run db:migrate:local
# 각각 별도 터미널
npm run dev:api
npm run dev:public-api
npm run dev
```

Node 24 필요. 로컬 관리자 `http://127.0.0.1:5190/admin?connected`, API 포트 8791/8792. 개발 키는 가상 테스트 전용이고 기존 운영 데이터는 복호화할 수 없습니다. 연결된 개발 API가 준비되면 `npm run test:integration`, 브라우저 준비 후 `npm run test:browser`를 실행할 수 있습니다. 본 인계에서 이 두 전체 앱 E2E 명령은 실행하지 않았습니다.

## 신규 환경 배포·복원

- 활성 마이그레이션은 **`migrations/events/`**입니다. 루트 `migrations/000*.sql`은 구 FIRST SEAT 자료이므로 적용하지 마세요.
- Vercel 실제 빌드 명령: `npm run build:events && node scripts/build-page-shell.mjs && mv dist/events/index.html dist/events/app.html`, 출력 `dist/events`. `vercel.json` rewrites를 보존합니다.
- 세 Worker의 `wrangler.production.jsonc`를 신규 설정으로 복사해 DB·Worker 이름·서비스 바인딩을 모두 새 것으로 변경합니다.
- 새 빈 DB에는 전체 `events-restore.sql`을 가져옵니다. 마이그레이션/seed를 먼저 실행하지 않습니다.
- `event_assets.content_base64`에 WebP 이미지 5개가 들어 있습니다. 별도 서버 이미지 저장소는 확인되지 않았고, DB의 JSON 이미지 필드에서 외부 이미지 URL 0개·누락 참조 0개를 확인했습니다. 편의를 위해 동일 이미지 파일도 아카이브에 추출했습니다. DB 복원만으로 현재 이미지 API를 복원할 수 있습니다.
- 배포 순서: 새 Data Worker → 새 Admin/Public Worker → 새 Vercel gateway. `npm run deploy:data/admin/public`은 기존 운영 설정을 사용하므로 신규 환경에서는 **직접 `npx wrangler deploy --config <NEW_CONFIG>`**를 사용하세요.
- Data Worker는 `workers_dev=false`; Admin/Public만 service binding의 `AdminEventsData`/`PublicEventsData`를 사용합니다. Data Worker의 15분 cron은 원본 보존/개인정보 파기 정책에 영향을 주므로 검증 중에는 새 환경에서 비활성화하고 운영 정책 확인 후 켜세요.
- 새 `SESSION_SECRET`으로 기존 Vercel 로그인 세션을 무효화하고 대상 DB의 `platform_sessions`를 비웁니다. 중복방지/동의/감사/결과 데이터는 보존합니다.

```sh
npx wrangler d1 execute seoularena-events-local --local --config workers/data/wrangler.events.jsonc --persist-to /secure/p011/events-local --file /secure/p011/events/events-restore.sql
```

위 명령은 `--local`이라 운영 DB에 쓰지 않습니다. 원격 복원은 신규 DB 설정으로만 수행합니다. 원본 Cloudflare export를 그대로 로컬 D1에 넣으면 외래키 생성 순서 및 긴 Base64 SQL 제한 오류가 발생했습니다. 제공된 `events-restore.sql`이 이 제한을 보완한 복원본입니다.

## 기존 암호화 데이터의 필수 조건

`PII_PRIVATE_KEY`, 대응 `PII_PUBLIC_KEY`, 기존 `IDENTITY_HMAC_KEY`가 있어야 기존 개인정보 복호화와 중복 대조가 유지됩니다. 키 버전은 `events-v1`입니다. 기존 키 원문은 이번 산출물에 포함되지 않았으며 Cloudflare에서 다시 읽어오는 기능도 없습니다. 원래 보관처의 키 인계 없이는 **데이터/이미지 복원은 가능하지만 개인정보 복호화까지 완전한 운영 이관은 불가**합니다. 새 키를 만드는 것만으로 기존 암호문이 복호화되지 않습니다.

깨끗한 설치·빌드·타입 검사, 단위 테스트 174개 및 Python 스키마 테스트 6개가 통과했습니다. 실제 운영 참여·SSO는 변경하거나 테스트 데이터를 쓰지 않았습니다.

## 백업 다운로드·복원

`delivery.json`에 비공개 다운로드 URL, 각 파일 크기 및 SHA-256이 있습니다. 두 서비스 데이터 모두 **비공개 티저 저장소의 GitHub Release 첨부파일**로만 제공합니다. 공개 Events 저장소에는 스키마·집계·문서만 있습니다. GitHub 계정 `jinsansung` 초대를 수락하고 로그인해야 다운로드할 수 있습니다. Git clone에는 데이터가 포함되지 않습니다.

```sh
gh release download p011-20261124-data --repo lily-arena/kakao-arena-teaser --pattern 'events-p011-20261124.tar.gz' --dir /secure/p011
# 내려받은 파일을 delivery.json의 SHA-256과 비교한 뒤 압축 해제
shasum -a 256 /secure/p011/events-p011-20261124.tar.gz
mkdir -p /secure/p011/events
tar -xzf /secure/p011/events-p011-20261124.tar.gz -C /secure/p011/events
python3 handoff/p011/verify-restore.py /secure/p011/events/events-restore.sql /secure/p011/events/check.sqlite
```

1. 접근 제한된 새 경로에서 작업합니다. 원본 SQL(`events-d1.sql`)과 D1 호환 복원본(`events-restore.sql`)을 함께 제공합니다. 복원본은 모든 스키마를 먼저 생성하고 긴 문자열을 분할해 D1 SQL 길이 제한과 순환 외래키를 처리합니다. 두 파일의 논리적 데이터는 검증 결과가 같습니다.
2. **새 빈 DB에 전체 복원본을 가져오세요.** 복원본 자체에 스키마와 `d1_migrations` 이력이 있으므로 기존 마이그레이션/seed를 먼저 적용하지 마세요. 원본 운영 DB 이름·ID를 복원 대상으로 쓰지 마세요.
3. 로컬 D1 복원 명령은 아래 프로젝트별 절차를 사용합니다. 원격 대상은 P011의 새 계정/DB ID를 넣은 별도 설정 파일을 만들어 승인된 새 DB에만 적용합니다.
4. 표별 행 수, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, 행 데이터 해시를 검증합니다. `verify-restore.py`는 원본/복원본에서 같은 결과인지 자동 비교합니다. 복원본은 민감 데이터를 포함하므로 로그에 행 내용을 출력하지 않습니다.
5. 이미지 파일과 참조를 확인한 뒤 애플리케이션을 연결합니다. `assets-inventory.json` 참조. 세션·OAuth 시도는 대상 DB에서만 폐기하고 재로그인시킵니다. 백업 원본과 기존 운영 DB는 변경하지 않습니다.
6. 운영 전환 전 신규 환경의 공개 API·관리자 권한·비공개 콘텐츠 차단·이미지·발행/복구를 확인합니다. 본 인계에서는 운영 도메인 전환·DNS·회사 SSO 변경을 수행하지 않았습니다.

## 비밀값 및 남은 접근 절차

`env.example`은 변수 이름·역할·설정 위치만 제공합니다. 실제 키·비밀번호·토큰은 포함하지 않았습니다. Cloudflare secret은 API에서 원문을 다시 읽을 수 없으므로 기존 관리자의 비밀값 저장소 또는 원래 키 보관처에서 새 환경에 등록해야 합니다. 새 통신용 키를 생성할 수 있지만, 기존 Events 개인정보 복호화/중복대조 키는 무작정 재발급하면 안 됩니다.

GitHub 초대 수락 전에는 P011 본인 다운로드 검증을 완료했다고 간주하지 않습니다. `access-verification.json` 참조. 제공자는 자기 권한의 다운로드/체크섬까지만 검증합니다.

## 검증 근거

`checks/`는 이 브랜치의 원본 커밋으로 만든 깨끗한 별도 checkout에서 `npm ci` 후 실행한 로그입니다. `restore-verification.json`은 운영 백업의 로컬 SQLite/D1 복원 결과입니다. 운영 Worker는 버전 ID와 실제 배포 코드 스냅샷 해시로 식별합니다. Cloudflare에 Git SHA가 없으므로 Git과 바이트 단위로 같다고 추정하지 않습니다. `manifest.json`에는 Vercel 운영 Git SHA가 따로 기록되어 있습니다.
