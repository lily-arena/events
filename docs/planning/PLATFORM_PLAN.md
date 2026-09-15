# 서울아레나 Events 플랫폼 설계·이전·구현 계획

작성일: 2026-09-15 · 초기 계획 보존본. 최신 승인·변경 사항은 같은 폴더의 APPROVED_CHANGES.md를 우선합니다.

## 요약 및 승인 제안

FIRST SEAT의 React/Vite 화면, Cloudflare 3개 Worker 경계, 암호화·동의·심사·투표 로직을 출발점으로 사용합니다. 단일 캠페인에 고정된 경로·단계·콘텐츠 구조는 이벤트 플랫폼 구조로 바꿉니다. 기존 앱 복제만으로는 요구사항을 충족하지 못합니다.

권장안은 다음과 같습니다.

1. `events.seoularena.net`과 `events-admin.seoularena.net`의 두 앱, 하나의

Google 로그인, 새로운 플랫폼 D1 하나.
2. FIRST SEAT는 첫 템플릿 인스턴스로 등록. 기존 운영 데이터·계정·키를 자동 복사하지 않고 기존 서비스는 그대로 유지.
3. Radix Primitives와 자체 공통 컴포넌트/CSS 토큰을 기반으로 제한된 모듈 빌더 구현. 공개 화면은 흑백, 넉넉한 여백, 명확한 서체와 절제된 효과. Admin은 목록·폼·업무 상태의 가독성 중심.
4. 처음부터 공모·투표·결과, 단일 접수, 투표 전용 템플릿을 지원. 생성·복제 후에는 코드 변경 없이 운영.
5. Vercel 유지 시 Pro 최소 월 US$20부터 검토. 무료가 절대 조건이면 Cloudflare Workers Static Assets로 두 화면까지 호스팅하는 대안 선택 필요.
6. 회사 계정 중 지정된 운영자만 단일 권한으로 접근하는 방식을 권장. 기존의 회사 계정 전체 자동 운영자 등록과 다른 보안 선택이므로 이번 계획에서 확정.

계획 승인으로 새 프로젝트 구현·합성 데이터 검증·새 GitHub push·승인된 인프라 배포까지 진행할 수 있습니다. 유료 활성화, 기존 운영 데이터 복사/삭제, 기존 서비스 전환은 각각 명시된 범위의 승인이 필요합니다.

## 1. 확인한 현재 구조와 재사용 범위

### 1.1 저장소 확인 결과

- 원본 로컬: `/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app`
- `git status --short --branch`: `main`, 추적/미추적 변경사항 없음.
- 로컬 HEAD 및 GitHub 원격 main/HEAD: `9af9d7158d65f9582a593c0db02c900e355b9d01`.
- 새 저장소 `lily-arena/events`: main/HEAD `593d301938a4b9c2a883898a69d30f415ffd7f69`, 파일은 `README.md` 하나이며 제목은 Seoul Arena Events.
- 원격은 `ls-remote`, 새 저장소는 임시 폴더의 no-checkout clone으로 확인. 원본에서 pull/fetch/checkout을 실행하지 않았습니다.
- 새 작업 폴더에는 이번 Markdown 계획만 작성. 원본 비밀값·인증 파일·DB·개인정보·빌드 결과를 복사하지 않았습니다.

### 1.2 코드 근거

아래 경로는 모두 위 원본 앱 기준입니다. 링크는 실제 로컬 파일로 연결합니다.

| 확인 사항 | 근거 | 재사용/변경 판단 |
|---|---|---|
| npm workspaces, React 18, Vite 6, TypeScript, Vitest/Playwright | [package.json](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/package.json), [Public package](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/apps/public/package.json) | 모노레포 유지. 새 프레임워크로 전면 전환 불필요 |
| 두 Vercel 앱의 같은 출처 API 중계 | [relay](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/packages/relay/src/index.ts), [배포 문서](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/docs/deployment.md) | 동일 출처 쿠키·서명 중계 재사용 |
| Public/Admin/Data Worker 분리 | [Public](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/public/src/index.ts), [Admin](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/admin/src/index.ts), [Data 설정](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/wrangler.jsonc) | D1은 Data만 소유, 개인정보 개인키는 Admin만 보유 |
| 단일 이벤트 고정 | Public의 `env.CAMPAIGN_SLUG`, Admin index 123행, [API](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/apps/public/src/api.ts) | 요청마다 event context를 해석하도록 변경. `/api/campaign` 고정 제거 |
| 제한된 블록 CMS | [blocks.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/packages/content/src/blocks.ts) | 필수 key와 순서가 고정. 추가·삭제·재정렬 빌더로 확장 필요 |
| 고정 단계와 공개 전환 | [state.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/packages/domain/src/state.ts), [actions.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/actions.ts) | 전환 전 후보/결과 snapshot 검증 유지, 고정 state 흐름은 typed stage로 변경 |
| 글자 수·연락처·이메일 검증 | [message.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/packages/domain/src/message.ts), [contact.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/packages/domain/src/contact.ts), [SubmissionForm](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/apps/public/src/SubmissionForm.tsx) | 정규화·숫자 입력·하이픈·서버 검증 재사용. 글자 수 계산 기준도 그대로 테스트 |
| 동의 원문과 버전 | [ConsentModal](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/apps/public/src/ConsentModal.tsx), [content.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/content.ts), [submissions.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/submissions.ts) | 현재 저장 경로는 동의문 변경 시 새 정책 버전 생성과 연결을 batch 처리 |
| 개인정보 암호화 | [envelope.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/packages/security/src/envelope.ts), [pii.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/pii.ts) | AES-GCM + RSA-OAEP, AAD/키 버전, 마스킹·열람 감사 유지 |
| 단일 운영자 권한 | [common.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/common.ts) | 역할 인자는 판정에 사용하지 않음. A/B/C·타인 승인·점수 강제 도입 금지 |
| 심사·후보·집계·최종 선택 | [review.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/review.ts), [shortlist.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/shortlist.ts), [votes.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/votes.ts), [result.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/result.ts) | 업무 규칙 유지, 모든 식별자 조회에 event 범위 추가 검증 |
| 중복투표 억제 | [voting.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/public/src/voting.ts), [초기 SQL](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/migrations/0001_init.sql) | 세션·epoch·유일성·Turnstile·속도 제한 유지. 완전한 1인 1표 인증은 아님 |
| 배경 갱신 입력 보존 | [App.tsx](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/apps/public/src/App.tsx), [회귀 스크립트](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/scripts/test-public-refresh.mjs) | 실패 시 기존 화면 유지. 신규 렌더러에서도 안정적인 모듈/필드 ID로 상태 보존 |
| 테스트 초기화 | [reset.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/admin/reset.ts), [Dashboard](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/apps/admin/src/screens/Dashboard.tsx), [0007](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/migrations/0007_campaign_test_reset.sql) | UI 두 번 확인, revision·멱등·batch 있음. 범위 snapshot 및 다중 이벤트 보호 강화 |
| 파기·감사·복원 대응 | [jobs.ts](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/workers/data/src/jobs.ts), [runbook](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/docs/runbook.md), [D1 audit](/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/first-seat/app/docs/d1-audit-storage.md) | D1 감사 원장·파기 원장·복원 전 삭제 목록 반출 절차 유지 |

### 1.3 문서와 코드의 차이

`README.md`에는 미배포/Cloudflare Access 설명이 남아 있지만, `docs/deployment.md`는 실제 배포 명칭 및 Google OIDC 중계를 설명합니다. `docs/privacy-dataflow.md`의 “Vercel에 개인정보가 지나지 않는다”, “원문 열람 미구현”도 현재 relay와 reveal 코드에 맞지 않습니다. 새 문서는 코드 기준으로 다시 작성합니다.

현재 원문 열람은 같은 관리자 세션으로 실행하며 서버가 기본 사유를 보완하는 경로가 있습니다. 예전 문서의 별도 재인증·사유 입력 강제를 새 제품 요구로 되살리지 않습니다. 또한 `admin/policy.ts`와 초기 SQL에는 과거 승인 관련 흔적이 있어 최신 `admin/content.ts` 경로와 구분해야 합니다. 새 스키마는 사용하지 않는 승인·jury score 절차를 포함하지 않습니다.

### 1.4 확인하지 않은 사항

운영 D1 행·개인정보·실사용 건수, 원격 migration 적용 목록, 현 Vercel 요금제/청구/프로젝트 권한, Cloudflare 사용량·secret 등록, 실제 DNS/TLS, Google OAuth 설정/회사 로그인 성공은 이번에 조회·실행하지 않았습니다. 운영 문서에 적힌 배포와 현재 운영 상태는 동일하다고 단정하지 않습니다. 전체 저장소의 보안 감사를 완료한 것도 아닙니다. 이번 단계는 코드 구조 검토이며 테스트·브라우저 실행·배포는 미수행입니다.

## 2. 목표 사용자 흐름과 Admin 정보 구조

### 공개 사이트

- `/`: 공개 상태인 이벤트만 카드 목록 표시. 제목·대표 이미지·현재 단계·기간·참여 버튼.
- `/:slug`: 해당 이벤트 현재 공개 단계. 로그인 없이 접근.
- `/:slug/submitted`, `/:slug/voted`: 서버 성공 확인 후 완료 안내. 주소 직접 접근을 참여 성공으로 취급하지 않음.
- `/:slug/privacy`: 현재 개인정보 안내. 동의 이력은 당시 버전을 별도 보존.
- 작성 중/비공개 이벤트는 루트, sitemap, 메타 정보, 공개 API 모두 제외. 직접 URL도 404. 임의 단계 URL로 미래 후보/결과를 조회할 수 없음.
- 결과 공개 후 보관은 운영 목록 정리의 의미. 기본적으로 공개 결과 유지, 별도 비공개 전환으로 목록·직접 접근 모두 숨김.

### 통합 Admin

| 범위 | 화면 | 담당자가 하는 일 |
|---|---|---|
| 전체 | 이벤트 | 공개/준비/보관 필터, 검색, 생성, 복제 |
| 전체 | 대시보드 | 이벤트별 현재 단계·다음 단계·참여 수·예정 마감 |
| 이벤트 | 개요 | 일정, 현재 공개 화면, 다음 전환, 일시 중단 |
| 이벤트 | 페이지 편집 | 단계/완료/대기 페이지 선택, 모듈 추가·정렬·속성, 미리보기 |
| 이벤트 | 응모작 | 검토 대기·승인·반려·후보, 필터, 상세 |
| 이벤트 | 후보 | 후보 지정 항목 자동 반영, 순서, 확정 |
| 이벤트 | 투표 현황 | 투표수·득표순, 집계 시각 |
| 이벤트 | 결과 | 확정 후보 중 하나 선택·확정·공개 예정 화면 확인 |
| 이벤트 | 동의·개인정보 | 원문 편집, 정책 버전, 마스킹/단건 열람, 보유기간·파기 |
| 이벤트 | 설정·운영 기록 | 공개 상태, 문의, 복제·보관, 테스트 초기화, 기록 |
| 전체 | 운영자·운영 기록 | 계정 활성/비활성, 이벤트 필터 및 전역 기록 |

이벤트 상단에 항상 이름·공개 상태를 고정합니다. 목록에서 다른 이벤트로 이동하면 이전 폼 데이터와 개인정보 화면 메모리는 제거합니다. 해당 이벤트에 없는 기능 메뉴는 숨깁니다. 개발 내부 용어인 epoch, revision, schema, DTO는 사용자 화면에 표시하지 않습니다.

## 3. 이벤트·단계·페이지·템플릿·모듈·테마

| 개념 | 역할 | 예 |
|---|---|---|
| 이벤트 | 데이터·운영·공개 상태의 독립 단위 | FIRST SEAT |
| 단계 | 참여 기능과 기간, 진행 순서를 갖는 업무 단위 | 공모 → 투표 → 결과 |
| 페이지 | 단계의 메인/완료, 공통 대기 화면 구성 | 공모 입력 화면·접수 완료 |
| 모듈 | 허용된 설정으로 렌더링하는 화면 단위 | 히어로·폼·동의·후보 목록 |
| 템플릿 | 단계·페이지·모듈·기능 연결의 시작 구성 | 공모 후 투표, 단일 접수, 투표 전용 |
| 테마 | 공통 토큰과 허용된 크기/배치 선택 | 흑백 기본, 좁은 본문/넓은 이미지 |
| 기능 연결 | 화면을 실제 저장/동의/투표 처리에 연결 | formId, policy slot, candidateSet |

템플릿에서 이벤트를 만들 때 독립된 설정 사본을 생성합니다. 템플릿 업데이트가 이미 공개된 이벤트를 자동 변경하지 않습니다. 템플릿과 모듈에는 schemaVersion을 기록하고 변경 시 명시적 변환기를 둡니다.

### 단계 모델

단계 종류는 `submission`, `voting`, `result`, `information`으로 제한하고 각 단계에 순서, 시작/마감, 상태, 페이지 참조, 입력 데이터 출처를 둡니다. 예를 들어 투표 단계는 “앞선 공모 후보” 또는 “관리자 등록 후보”를 선택하고 결과는 특정 후보 세트를 참조합니다. 같은 종류 단계의 추가도 가능하되 단계 ID와 round를 따로 둡니다.

작성 중에는 추가·삭제·재정렬 가능. 진행 중/기록이 생긴 단계와 참조되는 후보 출처는 제거할 수 없고, 미래 단계만 참조 무결성 검사 후 편집합니다. 반복 접수 단계는 새 단계로 추가하며 기존 응모 이력을 덮어쓰지 않습니다.

일정은 KST로 입력·표시하고 UTC 기준 저장, 서버는 `[시작, 마감)`으로 판단합니다. 최초 범위는 수동 공개 전환 + 설정 시각에 따른 서버 참여 제한입니다. 투표·결과 자동 공개는 실제 내용을 보며 확인하는 요구와 충돌하므로 후속 확장으로 둡니다. 마감 이후에는 Cron 지연과 무관하게 저장을 거절합니다. 기한이 지난 단계의 재개는 변경될 기한을 확인창에 표시합니다.

## 4. 최초 빌더 범위와 실제 기능 연결

### 4.1 기본 템플릿

- FIRST SEAT형: 공모 → 심사/후보 준비 → 투표 → 결과. 심사는 운영 상태이며 참여자에게 별도 폼을 강요하지 않음.
- 단일 접수형: 접수 → 완료/마감 안내. 후보·투표·결과 설정 불필요.
- 투표 전용형: 관리자 후보 등록 → 투표 → 선택적 결과. 가짜 응모작·개인정보를 만들지 않음.

### 4.2 모듈 레지스트리

| 모듈 | 수정 허용 | 서버 연결/공개 조건 |
|---|---|---|
| 제목·소개·히어로 | 제목, 소개, 이미지, 대체텍스트, 허용 비율 | 공개 승인된 asset만 사용 |
| 본문·이미지·안내 | 문단, 목록, 강조, 안전한 링크 | HTML/script/iframe 및 임의 CSS 금지 |
| 입력 폼 | 항목 추가/제거/순서, 이름, 도움말, 필수, 길이, 선택지 | form schema 버전에 따라 서버 검증·응모 저장 |
| 개인정보·응모작 활용 동의 | 제목, 필수 여부의 허용 범위, 원문 | policy version 연결·동의 이력 저장; 개인정보 수집 시 필수 동의 제거 불가 |
| 유의사항 | 전체 문단·목록 | 본문 전체 표시. 축약/접기 강제하지 않음 |
| 후보·투표 | 배치/설명/번호 표기 | 지정 단계의 확정 후보만; 서버 투표 command 호출 |
| 완료 안내 | 제목·본문·링크 | 성공 receipt와 연결; 미리보기는 가상 성공 |
| 최종 결과 | 제목·소개·이미지 | 확정 결과 참조; 화면 문자열로 우승자 우회 불가 |
| 문의·개인정보 링크 | 문의 채널, 링크 문구 | URL scheme/허용 목적지 검사 |

레지스트리는 `type`, `schemaVersion`, 설정 검증, 렌더러, 편집 폼, 허용 페이지, 필요한 기능, 최대 개수와 의존성을 정의합니다. 모듈 삭제 시 개인정보 수집과 필수 동의 연결이 깨지면 저장 초안은 가능하되 공개는 차단하고 바로 수정 위치를 안내합니다.

### 4.3 입력 항목

처음에는 단문, 장문, 이름, 국내 연락처, 이메일, 단일/복수 선택, 확인 항목을 지원합니다. FIRST SEAT의 문구·이름·연락처·이메일은 기본 구성으로 보존합니다. 타입마다 검증 함수를 공유하며 사용자 입력 정규식·SQL·스크립트를 받지 않습니다.

모든 필드는 불변 ID를 사용합니다. 응답은 제출 시 form version과 연결하며 이후 필드 이름 변경으로 과거 응답 의미가 바뀌지 않습니다. 이름·연락처·이메일 및 개인정보 가능성이 있는 추가 응답은 암호화 영역에 보관합니다. 공개 후보로 쓰일 대표 문구만 별도 명시적으로 분리하고 일반 답변 전체를 공개하지 않습니다. 후보 지정 전 개인 식별 내용이 들어 있는지 운영자가 확인할 수 있게 합니다.

실제 접수는 공개 버전 로드 → 필수/길이/형식 검증 → 현재 단계·시간·동의 버전·봇 방지 검증 → 암호화 → 응모/개인정보/동의/감사/멱등 결과를 한 transaction에 저장 → 완료 화면 순서입니다. 일부 저장 후 성공 처리하는 경로를 두지 않습니다.

### 4.4 편집·미리보기·공개

화면은 왼쪽 모듈 목록, 가운데 미리보기, 오른쪽 선택 모듈 설정을 기본으로 합니다. 순서 변경은 버튼/키보드로 완전히 가능하게 하고 드래그는 보조 수단입니다. 미리보기 390px/1440px 선택, 실제 공개와 같은 렌더러 사용. Admin 내부 인증된 미리보기에서만 초안과 가상 후보를 제공하며 실제 응모·투표를 저장하지 않습니다.

새 이벤트는 임시 저장 → 미리보기 → 공개, 현재 공개 중 문구 수정은 `저장하고 반영` 한 번, 구조 편집은 `임시 저장`/`공개 반영`으로 구분합니다. 타인 승인 단계 없음. 한 화면 저장은 하나의 버전으로 원자 적용합니다. 충돌하면 최신 내용 확인을 요청하되 입력한 초안은 유지합니다.

동의문이 바뀌면 새 버전을 적용하고 기존 이력을 보존합니다. 참여 중 구버전 동의로 제출하면 입력 내용은 유지한 채 변경된 동의만 다시 확인받습니다. 배경 재조회 시 폼을 unmount하거나 버전 번호로 key를 바꾸지 않습니다. 실제 단계 종료 시에도 조용히 입력을 지우지 않고 마감 안내를 표시합니다.

### 4.5 이미지 저장의 최초 범위

무료/D1 하나를 유지하려면 이미지 업로드 저장소도 명확해야 합니다. 최초안은 공개용 정적 JPEG/PNG/WebP를 관리자 브라우저에서 최적화하여 건당 최대 500KB, 이벤트당 10MB, 플랫폼 전체 50MB 한도로 D1 BLOB에 저장하는 제한적 방식입니다. 메타데이터와 불변 content hash를 연결하고 공개본만 캐시합니다. 이는 현재 500MB DB 한도 안에서 소규모 운영하기 위한 설계 선택이며 일반적인 대용량 이미지 저장 권장은 아닙니다.

서버는 파일 시그니처/형식/크기 검증, SVG/HTML/동영상 차단, `nosniff`, 안전한 Content-Type, 초안 이미지 접근 제어를 수행합니다. 원본/EXIF 보관은 하지 않습니다. 업로드 CPU·쿼리 크기·응답 캐시 부하를 합성 데이터로 검증합니다. 미달 시 임의 유료 저장소 도입 없이 결과를 보고합니다. R2는 이후 확장 대안이며 D1을 추가하지 않고 asset 저장소만 변경할 수 있는 인터페이스를 둡니다.

후속 범위: 대용량 이미지/R2, 동영상, 조건부 분기 폼, 다국어, 예약 자동 공개, 외부 CRM/문자 연동, 추첨·복수 수상자, 복잡한 심사 배점, 범용 자유 캔버스. 최초 완료 기준에 필요하지 않으므로 자동 추가하지 않습니다.

## 5. 컴포넌트 라이브러리 비교와 디자인

조사일 2026-09-15. 공식 저장소와 문서만 기준으로 비교했습니다. 아래는 후보를 비교한 것이며 동시 도입 제안이 아닙니다.

| 후보 | 무료/상업 이용 | 접근성·모바일 | 현 기술 호환·부담 | 유지보수·브랜드 조정 | 판단 |
|---|---|---|---|---|---|
| Radix Primitives | MIT, 무료. 저작권/허가문 유지 | 키보드·포커스·ARIA 패턴 제공. 반응형 배치는 자체 작성 | React 앱에 필요한 primitive만 추가. Tailwind 필수 아님 | 공식 release log 유지. 무스타일이라 흑백 토큰 적용 용이. 스타일 품질은 직접 책임 | 권장 |
| shadcn/ui | 공식 코어 MIT, 무료. 제3자 유료 block은 별개 | 접근성 primitive 기반, 조합 후 재검증 필요 | Vite 공식 가이드. Tailwind 및 선택 primitive 설정 추가 | 소스를 소유하므로 수정 쉬우나 업데이트 병합도 우리 책임. 현재 프로젝트 CSS 전략 변경 필요 | 빠른 Admin 제작 대안 |
| Mantine | 공식 코어 MIT, 무료 | 폼/모달 등 풍부, 반응형 옵션. 최종 흐름 접근성 검증 필요 | React/Vite 지원, core/hooks/styles 및 선택 패키지. React 18 호환 버전 고정 필요 | 공식 변경 이력 운영. 업무 화면 제작 빠름, 공개 브랜드를 위해 기본 스타일 조정 필요 | 풍부한 백오피스 우선 시 대안 |

권장: Radix를 단일 기반으로 Dialog/AlertDialog/Tabs/Select/Checkbox 등 필요한 항목만 쓰고, 버튼·입력·표·페이지·모듈은 `packages/ui`와 `packages/event-renderer`에서 관리합니다. 별도 shadcn/Mantine를 혼합하지 않습니다. 안정 버전/peer dependency는 구현 시작 시 재확인하여 lockfile에 고정하고 라이선스 고지 파일을 둡니다. 라이브러리만으로 접근성 준수를 보장하지 않습니다.

토큰: 흰 배경·검정 본문·명도별 중립 회색, 서체/크기/행간, 4/8 기반 여백, 콘텐츠 폭, 테두리, 밑줄 offset/thickness, radius, 포커스, 버튼/폼 크기. 이벤트별 임의 색/서체/CSS 입력 없음. 오류는 색에 의존하지 않고 문구·위치·테두리로 표시합니다. 공개 화면에 불필요한 색·과장된 그림자·장식적 애니메이션을 넣지 않습니다. Apple의 독점 자산/웹폰트를 복사하지 않고 시스템 서체 및 사용권 확인된 Pretendard 후보를 사용합니다. Admin은 같은 primitive를 쓰되 더 조밀한 별도 토큰을 허용합니다.

근거: [Radix 라이선스](https://github.com/radix-ui/primitives/blob/main/LICENSE), [접근성](https://www.radix-ui.com/primitives/docs/overview/accessibility), [릴리스](https://www.radix-ui.com/primitives/docs/overview/releases), [shadcn 라이선스](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md), [Vite 설치](https://ui.shadcn.com/docs/installation/vite), [Mantine 라이선스](https://github.com/mantinedev/mantine/blob/master/LICENSE), [시작 가이드](https://mantine.dev/getting-started/), [변경 이력](https://mantine.dev/changelog/all-releases/).

## 6. 이벤트별 데이터 분리와 D1 변경안

### 6.1 기존 D1 확장과 신규 D1 비교

| 선택 | 장점 | 위험/부담 | 권장 |
|---|---|---|---|
| 기존 운영 D1 확장 | 기존 데이터 복사 생략 가능 | 옛 서비스의 trigger·schema·Cron과 결합, 실수 시 기존 운영 영향, 복구 범위 공유 | 비권장. 별도 승인 없이는 접근/변경하지 않음 |
| 새 Events D1 하나 | 기존 서비스 무변경, 독립 schema·키·배포, 테스트 분리 | 실제 데이터 이전 선택 시 변환/대조 필요 | 권장 |

“D1 하나”는 새 플랫폼의 운영 DB 하나를 뜻합니다. 과도기에는 기존 FIRST SEAT DB도 별도로 존재합니다. 로컬 테스트는 임시 로컬 D1, 원격 검증 DB가 필요하면 별도 비운영 DB로 하고 운영 데이터는 넣지 않습니다. 같은 Cloudflare 계정에서는 기존/신규 사용량이 무료 한도를 공유할 수 있어 DB 분리만으로 쿼터가 독립하지 않습니다.

### 6.2 목표 스키마

| 묶음 | 주요 테이블·키 | 목적 |
|---|---|---|
| 플랫폼 | administrators, admin_sessions | 회사 신원/활성 상태, 이벤트마다 계정 생성 안 함 |
| 이벤트 | events(id, slug UNIQUE, visibility, archived_at, active_stage_id, revision, reset_generation) | 공개/보관/현재 단계 분리 |
| 구성 | event_stages(event_id,id,type,position,state,starts_at,ends_at), event_versions | 단계와 설정 이력 |
| 페이지 | pages(event_id,id,stage_id,kind), page_versions, page_publications | 불변 모듈 JSON과 공개 포인터 |
| 폼 | forms, form_versions(event_id,id,schema_json) | 입력 항목/검증/개인정보 분류 |
| 자산 | assets(event_id,id,hash,mime,bytes,status) | 공개 이미지·초안 분리 |
| 정책 | policy_documents(event_id,id,kind,version,body,digest), policy_bindings | 동의문 버전 및 현재 적용 |
| 접수 | submissions(event_id,id,stage_id,form_version_id,page_version_id,status,public_text) | 대표 응모 내용·검토 상태 |
| 개인정보 | pii_records(event_id,submission_id,envelope,key_version,aad_version,retention_until) | 연락처와 비공개 답변 암호화 |
| 동의 | consent_receipts(event_id,id,submission_id/session_id,policy_id,accepted_at) | 당시 버전과 실제 수락 연결 |
| 투표 | candidate_sets, candidates, anonymous_sessions, votes, vote_risk_signals | event_id + stage_id + round/epoch 범위 |
| 결과 | results(event_id,id,stage_id,set_id,winner_candidate_id,version) | 확정 후보 중 선택한 결과 |
| 운영 | audit_events(event_id nullable), audit_signatures, deletion_jobs, deletion_ledger, reset_runs | 이벤트 작업/전역 계정 작업 구분 |
| 보호 | idempotency_records, rate_buckets, operation_guards | event_id와 generation 포함 |

업무 테이블은 `event_id NOT NULL`. 전역 계정·전역 감사만 예외입니다. `(event_id,id)` 유일키와 복합 외래키를 사용하여 다른 이벤트의 정책·후보·폼·응모 ID 연결을 DB에서 거절합니다. 일반 목록은 `(event_id,status,created_at,id)` 인덱스, 집계는 `(event_id,stage_id,round,candidate_id)` 인덱스를 사용합니다.

Data Worker의 조회 함수는 필수 EventContext를 받아야 합니다. `WHERE id=?`만으로 응모 상세/열람/수정/삭제하지 않고 `WHERE event_id=? AND id=?`를 적용합니다. 페이지 cursor, 캐시 키, rate key, 멱등 키도 같은 범위를 포함합니다. 전체 대시보드는 별도 전역 집계 함수에서 이벤트별 group by로만 처리합니다. D1에 자동 행 단위 접근 정책이 있다고 가정하지 않습니다.

여러 이벤트가 동일 쿠키를 공유하는 문제는 하나의 익명 브라우저 토큰에서 `event_id + stage_id + round`를 포함해 세션 hash를 파생하는 방식으로 해결합니다. 브라우저 토큰 자체는 개인정보가 아니며 서버 세션은 이벤트별로 독립합니다. 한 이벤트 초기화가 다른 이벤트 쿠키·투표권을 해제하지 않아야 합니다.

## 7. API·인증·개인정보·동의·삭제

### API 경계

| 요청 | 목적 |
|---|---|
| `GET /api/events` | 공개 목록만 |
| `GET /api/events/:slug` | 현재 공개 구성/상태/정책 |
| `POST /api/events/:slug/sessions` | 이벤트 범위 익명 세션 |
| `POST /api/events/:slug/submissions` | 서버 검증 후 접수 |
| `GET /api/events/:slug/candidates`, `POST .../votes`, `GET .../result` | 단계별 후보·투표·결과 |
| `GET/POST /api/admin/events`, `POST .../:eventId/duplicate` | 전체 관리·생성·복제 |
| `PUT .../:eventId/pages/:pageId`, `POST .../publish` | 초안 저장·공개 버전 적용 |
| `POST .../:eventId/transitions/preview`, `POST .../execute` | 실제 후보/결과 snapshot 및 변경 확인 |
| `PATCH .../:eventId/submissions/:id`, `POST .../:id/reveal` | 심사·단건 원문 열람 |
| `POST .../:eventId/reset/preview`, `POST .../confirm`, `POST .../execute` | 삭제 범위와 최종 확인 |

API 계약을 새 OpenAPI로 작성하고 서버/클라이언트 공유 validation schema를 둡니다. slug는 서버에서 event_id로 해석하며 요청 본문의 임의 event_id를 신뢰하지 않습니다. 모든 변경은 인증/CSRF·origin·멱등/버전 조건을 적용합니다. 인증 실패는 401/403, 다른 이벤트 ID는 404, 버전 충돌은 409, 입력 오류는 필드 단위로 반환합니다.

### 회사 로그인

Google OIDC Authorization Code + PKCE/state/nonce, 서버에서 서명/issuer/audience/expiry/email_verified/hd와 실제 이메일 도메인 모두 검증합니다. 신원키는 issuer+subject, 단순 이메일 suffix 비교만 사용하지 않습니다. 앱 전체 OAuth 클라이언트 하나, 관리자 쿠키는 Admin 호스트 전용 HttpOnly/Secure/SameSite, 공개 앱으로 공유하지 않습니다.

권장 권한은 회사 계정 + 운영자 허용 목록, 모든 운영자는 동일 권한입니다. 초기 운영자 1명은 서버 설정에서 등록하고 이후 운영자 활성/비활성 기능 제공. 계정 관리 시 마지막 활성 운영자 제거 방지. 기존처럼 회사 전체 자동 등록을 선택할 수도 있으나 모든 직원에게 개인정보 열람·초기화 권한이 열리는 차이를 확인해야 합니다. 역할별 승인·타인 결재는 없습니다.

### 개인정보와 동의

브라우저 → Vercel relay → Public Worker에서 평문 처리 → 암호화 → Data Worker/D1 순서입니다. Vercel도 처리 경로에 포함됨을 운영 문서에 명시합니다. Admin Worker만 복호화 가능, Public은 공개키만, Data는 개인키 없음. 프론트 bundle·로그·URL·분석도구·브라우저 영속 저장에 원문/토큰을 남기지 않습니다. Vercel 및 Worker 로그 본문 수집을 끄고 오류 보고를 정제합니다.

열람은 인증된 단건 요청, 서버 감사가 성공한 후 반환, `Cache-Control: no-store`, 화면 60초/탭 비활성/이벤트 이동 시 제거. 기본 사유 자동 기록으로 일반 운영 흐름을 단순화합니다. 감사 실패 시 원문 반환을 막습니다. 신규 키는 별도 발급·안전한 보관·키 버전으로 교체 가능하게 합니다.

동의문은 불변 버전, 동의 receipt는 정책 ID/버전·시각·참여 ID·당시 폼/페이지 버전에 연결합니다. 필수/선택 동의 분리, 미리 체크 금지, 자세히 보기 제공. 정책 수정이 과거 동의 의미를 바꾸지 않습니다. 보유기간·법인명·문의처·국외 처리 안내는 실제 운영 문안 확인 후 설정하며 임의의 법적 충족을 주장하지 않습니다.

### 참여 억제

이벤트/단계별 설정으로 중복 응모 허용/브라우저 기준 1회, 투표 브라우저 기준 1회, Turnstile 켜기/끄기, 속도 제한을 지원합니다. FIRST SEAT 기본은 Turnstile + 기존 방식의 세션/epoch/DB 유일성 + IP HMAC 위험 신호. IP 단독 일괄 차단은 공유망 팬을 막을 수 있어 엄격한 1인 판별로 사용하지 않습니다. 쿠키 삭제·기기 변경은 우회 가능하며 본인인증 없는 억제라는 한계를 운영 도움말에 설명합니다.

### 파기와 테스트 초기화

일반 개인정보 파기는 보유기간 만료/단건 요청에 따른 비동기 작업으로 처리하고, 암호문·wrapped key·마스킹·비공개 응답을 함께 삭제합니다. 응모 문구 보존 여부는 파기 종류에 명시합니다. 감사 원장은 본문·연락처를 담지 않습니다.

테스트 초기화는 다음과 같습니다.

1. 서버가 대상 이벤트 이름/slug와 응모·개인정보·동의·후보·투표·결과·세션 건수, 보존 항목을 계산. 사용자 첫 번째 범위 확인.
2. 서버가 event_id, actor, revision, 데이터 generation/count snapshot, 만료 시각에 묶인 확인 토큰 발급. 두 번째 창에서 실제 삭제/공모 시작을 최종 확인.
3. 실행 직전 snapshot 및 신규 참여 변동 재검증. 달라졌으면 재확인. 해당 이벤트 변경 잠금/transaction guard로 동시에 들어오는 접수·투표·파기 작업과 경쟁 방지.
4. 대상 응모·PII·동의 이력·후보·투표·결과·익명 세션·중복 제한·멱등 응답을 삭제/무효화하고 generation 증가. 화면 문구·동의문 원문/버전·운영자·감사/파기 원장·reset 이력은 보존.
5. 전부 성공하고 잔여 건수가 0임을 확인한 뒤 첫 접수 단계 개시. 단일 작은 transaction을 우선하되 한도 초과 규모는 잠금 상태에서 재개 가능한 batch job으로 끝까지 삭제 후 개시. 중간 실패 시 접수를 열지 않음.

버튼의 “테스트 데이터”는 행의 테스트 여부를 자동 판별한다는 뜻이 아닙니다. 해당 이벤트의 모든 참여 기록이 대상임을 명확히 표시합니다. 투표 전용은 “초기화 후 투표 시작”으로 기능에 맞게 바꾸며 공모 단계를 강제로 추가하지 않습니다. 실제 운영 데이터로 초기화 테스트하지 않습니다.

D1 Time Travel 복원은 다른 이벤트와 삭제 원장까지 되돌릴 수 있습니다. 복원 전 현재 삭제 목록을 DB 밖 안전한 위치에 별도 보존하고 복원 후 재삭제·검증합니다. 온라인 삭제와 백업 내 즉시 완전 삭제를 동일하게 표현하지 않습니다. D1 내부 HMAC 원장은 DB 소유자의 전체 변조를 막는 외부 불변 저장소는 아닙니다.

## 8. FIRST SEAT 이전·호환성

### 권장 기본 범위: 코드/구성 이전, 실제 참여 데이터 이전 없음

검증된 커밋의 코드와 추적된 비민감 정적 문구/템플릿만 허용 목록으로 가져옵니다. 새 이벤트는 비공개 상태이며 첫 접수부터 새로 시작할 준비를 합니다. 기존 서비스는 계속 운영합니다. 단, 기존에 실제 공모/투표가 진행 중이면 같은 이벤트를 새 사이트에서 중복 개시하지 않고 운영 전환 여부를 먼저 확정합니다.

기존 배포 설정·DB ID·Worker 이름·OAuth secret·암호화키를 새 프로젝트에 재사용하지 않습니다. 운영 DB에서 관리자가 수정한 최신 문구는 Git과 다를 수 있으므로, 코드상의 seed를 최신 운영 문구라고 표현하지 않습니다. 실제 공개 문구만 별도 확인하여 옮길 수 있고 데이터 추출이 필요하면 범위를 승인받습니다.

### 실제 참여 데이터까지 옮기기로 결정할 경우의 별도 실행안

1. 이전 대상 event, 테이블, 시점, 건수, 암호화 키 처리, 보유기간, 서비스 중단/전환 시간과 rollback 조건을 문서화해 승인.
2. 읽기 전용 현황/적용 migration 확인, 암호화된 백업을 저장소 밖 제한된 위치에 보관. 비밀값/PII는 Git에 넣지 않음.
3. 합성 데이터로 같은 schema 변환을 리허설하고 모든 FK/상태/동의/표 집계/선정 결과를 대조.
4. 실제 이전은 legacy ID 매핑을 보존. 기존 AAD가 `campaignId, submissionId, keyVersion, aadVersion`이므로 단순 ID 변경이나 AAD 필드명 치환은 복호화를 깨뜨립니다. legacy 암호 context 보존 + 제한적 구키 주입 또는 통제된 메모리 재암호화를 선택해 별도 승인. 정책 원문/버전·당시 동의·보유기한을 그대로 연결.
5. 쓰기 전환이 필요한 경우 승인된 짧은 기존 접수 중지 후 최종 delta/건수/checksum 확인. 이 시점만 기존 서비스 변경이며 자동 수행하지 않음. 무중단 요구면 추가 CDC/dual-write 설계가 필요하므로 이번 최초안에 포함하지 않음.
6. 새 서비스 smoke test 후 전환. 옛 도메인 redirect도 명시적 승인 후에만 적용. 이전 후 새 참여가 생기면 옛 DB로 단순 rollback할 수 없으므로 신규분 보존·대조 계획을 먼저 실행.

새 도메인에서는 기존 host-only 쿠키를 승계할 수 없습니다. 본인인증 없는 투표 이력은 새 브라우저 세션과 완전하게 매칭할 수 없어, 진행 중 투표를 도메인 간 이동하면 재투표 억제가 약해집니다. 따라서 활성 투표 중 이전은 피하고 기존 라운드 종료 후 이전하는 것을 권장합니다. 이 제약을 해결하지 않은 채 “기존 중복 제한 완전 승계”를 약속하지 않습니다.

## 9. 새 저장소·폴더·개발 구조

작업 루트: `/Users/joohee/.codex/.chatgpt-projects/g-p-684a715c608c8191ba758093edb261e0/outputs/events`

```text
events/
  PLATFORM_PLAN.md
  apps/public/                  # Vercel 참여자 앱
  apps/admin/                   # Vercel Admin·OIDC
  workers/public/               # 참여·암호화·봇 방지
  workers/admin/                # 운영 인증 경계·복호화
  workers/data/                 # D1·도메인 처리·Cron
  packages/domain/              # event/stage 업무 규칙
  packages/schema/              # 모듈·폼·API 검증 계약
  packages/ui/                  # 공통 primitive·컴포넌트·토큰
  packages/event-renderer/       # 공개/미리보기 공용 렌더러
  packages/templates/           # 3개 시작 템플릿
  packages/security/            # 암호화·마스킹·CSRF·서명
  packages/relay/               # Vercel-Worker 중계
  migrations/                   # 새 D1 전용 schema
  scripts/                      # 로컬 fixture·배포 사전검사
  tests/unit,integration,security,e2e/
  docs/                         # DNS/OAuth·운영·이전·비용
  config/                       # 환경별 비밀값 없는 예시
  .github/workflows/            # 새 대상만 배포
```

승인 후 새 저장소를 별도 임시 위치에 clone한 뒤 이번 문서를 보존해 작업 루트를 구성하고 기존 README/이력을 유지합니다. `events-platform` 작업 브랜치에서 작업, 승인된 검증 결과만 새 저장소에 반영합니다. 원본 저장소 이력을 통째로 가져오지 않고 기준 커밋을 문서에 기록합니다.

복사 허용: 검토한 소스·migration 참고자료·테스트·라이선스 확인된 정적 자산. 복사 제외: `.git`, `.env*`(안전한 example만 새 작성), `.dev.vars*`, 인증 JSON/PEM, `.vercel`, `.wrangler*`, 로컬 DB/WAL, node_modules, 캐시, dist/build, 업로드/응모 데이터, 운영 로그/스크린샷, 상위 `deploy-secrets.local.json`. 추적된 파일도 무조건 안전하다고 가정하지 않고 secret/PII 스캔 후 stage.

예상 명령은 기존 npm workspaces 방식의 `npm ci`, `npm run dev:data`, `dev:public-api`, `dev:admin-api`, `dev:public`, `dev:admin`, `typecheck`, `test`, `test:integration`, `test:security`, `test:e2e`, `build`로 정리합니다. 이는 새 제품 구현 시 정의할 명령이며 아직 실행 가능한 앱이 생성된 것은 아닙니다. 로컬 포트는 기존 앱과 충돌하지 않는 별도 범위로 지정합니다.

## 10. Vercel·Cloudflare·DNS·OAuth 연결 계획

### 권장 Vercel 구성

Vercel `events-public`, `events-admin` 두 프로젝트, 동일 `lily-arena/events` 저장소에서 앱별 Root Directory와 모노레포 build 설정. Data/Public/Admin Workers는 `events-data-prod`, `events-public-prod`, `events-admin-prod`, 신규 D1 이름 `events`. 실제 이름 가용성/ID는 생성 후 기록합니다.

브라우저의 같은 출처 `/api` → Vercel 서명 중계 → 해당 Worker → Data binding. Data Worker의 외부 route/workers.dev/preview 접근은 비활성화. 서명은 method/path/query/body/time/identity/client IP를 묶고 클라이언트가 주입한 신원 헤더는 제거합니다. 개발 인증 우회는 production에서 강제 차단. 새 환경의 key/secret는 별도 발급하며 저장소에는 이름/설명만 넣습니다.

새 GitHub Actions는 테스트/빌드/secret scan 후 배포하고 실제 운영 migration은 승인 범위 확인 후 별도 단계로 실행합니다. 새 빈 DB 초기 생성은 계획 승인 범위, 이후 파괴적 migration은 재승인. expand 방식 migration → Data → Public/Admin → Vercel 순서. Vercel의 자동 배포가 Worker보다 먼저 뜨지 않도록 초기 Git 자동 production 배포를 제어하거나 배포 orchestration으로 승격 순서를 관리합니다. rollback은 코드와 DB를 구분합니다.

### DNS 담당자 전달표

| FQDN / DNS 이름 | 종류 | 값 | 현 상태 |
|---|---|---|---|
| `events.seoularena.net` / `events` | CNAME | 새 `events-public` 프로젝트가 발급한 정확한 target | 프로젝트 생성 전 미발급 |
| `events-admin.seoularena.net` / `events-admin` | CNAME | 새 `events-admin` 프로젝트가 발급한 정확한 target | 프로젝트 생성 전 미발급 |
| Vercel이 요구한 검증 이름(통상 `_vercel`) | TXT | 각 도메인의 새 소유 검증 문자열 | 요구 시 발급값 그대로 전달 |

CNAME target과 TXT는 프로젝트별 발급값이므로 현재 정확한 값을 만들 수 없습니다. 기존 FIRST SEAT CNAME/TXT를 복사하거나 범용 값을 정답으로 전달하지 않습니다. 승인 후 프로젝트/도메인 등록으로 값을 받은 다음 `docs/DNS_HANDOFF.md`를 실제 값으로 완성합니다. 회사 담당자가 DNS only로 신규 레코드를 설정하며 기존 FIRST SEAT·apex·NS·MX는 변경하지 않습니다. 같은 이름의 기존 TXT가 있으면 보존하고 필요한 값을 추가합니다. TTL은 DNS 기본값/Auto 권장. [Vercel 공식 도메인 안내](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

### Google OAuth 담당자 전달표

- 표시 이름 제안: Seoul Arena Events Admin.
- 회사 소유 Google Cloud 프로젝트의 웹 애플리케이션 OAuth 클라이언트 하나. 가능하면 Workspace 조직 내부 audience.
- 확정할 운영 redirect URI: `https://events-admin.seoularena.net/api/auth/callback`
- 운영 로그인 진입점: `https://events-admin.seoularena.net/api/auth/login`
- scope: `openid email profile`만. Drive/메일 접근 권한 불필요.
- 서버 redirect 방식이므로 JavaScript origins는 기본적으로 불필요. 클라이언트 방식 도입 시에만 별도 검토.
- 검증용 URI는 실제 생성된 고정 Admin 검증 호스트의 `/api/auth/callback`만 추가. wildcard/임의 Vercel preview 주소 금지, 필요 없는 검증 URI는 제거.
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`는 Vercel Admin 서버 환경변수로만 제공. 채팅/문서/Git 저장 금지.
- 이벤트 추가 시 OAuth 앱·redirect URI 추가 불필요. 기존 FIRST SEAT OAuth 수정 없이 별도 플랫폼 클라이언트 권장.

redirect URI는 Google 등록값과 정확히 일치해야 합니다. [Google 서버 OAuth 문서](https://developers.google.com/identity/protocols/oauth2/web-server).

회사 담당자 작업: 도메인 확정, DNS 레코드 등록, OAuth 클라이언트/내부 audience와 최초 운영자 지정. 구현 담당 작업: 프로젝트·환경변수·callback·TLS·실제 로그인·외부 계정 거부 검증. DNS가 미적용이면 배포 성공과 사용자 도메인 정상 운영을 구분해 보고합니다.

## 11. 무료 운영 가능 여부·한도·제약

2026-09-15 공식 문서 확인 기준. 계정의 실제 계약/잔여 사용량은 미확인입니다. 달러 금액은 세금·환율·초과 사용·추가 seat 제외입니다.

| 구성 | 무료/최소 비용 | 목적 적합성과 제한 |
|---|---|---|
| Vercel Hobby | US$0 | 개인·비상업용 제한. 회사 마케팅 사이트는 사용 목적에 맞지 않아 권장 불가 |
| Vercel Pro | 플랫폼 월 US$20, 배포 seat 1개·사용 credit US$20 포함 | 두 앱을 같은 팀에 둘 수 있어 최소 비용이 앱당 US$20씩이라는 뜻은 아님. 추가 배포 seat/사용량 과금 가능. Admin 로그인 사용자 수와 Vercel 유료 seat 수는 별개 |
| Workers Free | 일 100,000 요청, 호출 CPU 10ms | 로그인·암호화·이미지·batch의 실제 CPU 검증 필요. 무료 한도 초과 시 실패/중단 가능 |
| Workers Paid | 월 최소 US$5 + 초과 사용 | 부하/CPU 때문에 필요할 때만 승인 요청. 계정 단위 플랜 효과 확인 |
| D1 Free | 일 5백만 rows read / 10만 rows written | 반환 건수가 아닌 스캔·쓰기 행 기준. 삭제·인덱스 갱신·감사 기록도 예산에 반영 |
| D1 저장 한도 | Free DB당 500MB, 계정 합계 5GB/10 DB | 플랫폼 D1 하나는 5GB가 아니라 500MB가 우선 상한. Free 복원 이력 7일 |
| Turnstile Free | 최대 20 widgets, widget당 10 hostnames, challenge 무제한 | 공식 안내가 중소기업/운영 앱을 포함. 플랫폼 도메인 단위 사용으로 이벤트마다 widget 불필요 |
| GitHub | 현 계정 플랜 확인 필요 | private repo Actions/저장량의 포함 한도를 확인해 CI 빈도 설정. secret를 위한 공개 repo 이용은 금지 |
| Google 로그인 | 기존 Workspace 활용 | 유료 SAML/별도 사용자 인증 서비스 도입 불필요. 현재 Workspace/조직 설정은 담당자 확인 |

권장 최소안: **Vercel Pro + Workers/D1/Turnstile 무료 범위**, 추가 구독 비용은 월 US$20부터. 이미 적합한 Pro 팀이 있으면 추가 고정 비용 여부가 달라질 수 있습니다. Free CPU/부하가 부족하면 Workers Paid로 월 최소 US$25 조합을 재검토합니다. 어느 유료 플랜도 지금 활성화하지 않습니다.

예산 0원 우선 대안: 두 React 화면을 Cloudflare Workers Static Assets에 두고, Google callback/relay를 Worker runtime으로 옮깁니다. 정적 asset 요청/저장은 무료이고 동적 API는 Workers 한도를 사용합니다. 이는 Vercel 목표를 변경하므로 선택 승인 후만 적용합니다. Cloudflare self-serve 약관 검토에서 Vercel Hobby와 같은 개인·비상업 전용 제한은 확인되지 않았으며, Free 서비스의 중단/책임 제한과 일반 이용 조건은 적용됩니다. 회사 사용을 무제한·무조건 보장한다는 의미는 아닙니다.

운영량 추정은 참가자 수가 아닌 실측식으로 합니다: `일 참여 수 × 참여당 D1 쓰기 + 세션/감사/Cron/운영 쓰기`. 예를 들어 참여당 12행 쓰기라면 5,000건도 약 60,000행이며 인덱스와 부수 작업을 더하면 한도가 가까워질 수 있습니다. 이는 가정 예시이고 수용량 보증이 아닙니다. 합성 테스트에서 meta.rows_read/rows_written, CPU p95, DB 크기, 공개 API 횟수, 429/503을 측정하고 안전 운영량을 산출합니다. 같은 계정의 FIRST SEAT 사용량도 합산합니다.

공개 후보/문구/이미지는 버전 기반 cache, Admin 집계는 페이지네이션/제한된 재조회, 비활성 탭 polling 중단. 참여 command는 캐시를 신뢰하지 않고 최신 서버 상태로 판정합니다. 비용 알림은 상한 보장이 아니므로 Vercel spending controls와 한도 도달 시 정지 동작도 검증합니다. 자동 유료 전환·과금 옵션을 임의 활성화하지 않습니다.

근거: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Pro](https://vercel.com/docs/plans/pro-plan), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/), [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/), [D1 한도](https://developers.cloudflare.com/d1/platform/limits/), [Turnstile](https://developers.cloudflare.com/turnstile/plans/), [Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Cloudflare 약관](https://www.cloudflare.com/terms/).

## 12. 구현 순서·검증·승인 사항

### 구현 순서

1. 이번 계획 승인: 인프라/예산, 새 DB, 관리자 범위 확정. TASK/DECISIONS에 승인 범위 기록.
2. 원격 최신 커밋 재확인, 새 repo 이력 보존, 허용 파일만 가져오기, 신규 secret/환경 분리, 기존 테스트의 합성 기준선 실행.
3. event/stage/form/page schema, Data API EventContext, 복합 FK, 공개 상태/전환 guard, 세션 범위, 새 migration 구현.
4. 대표 수직 기능 구현: 이벤트 생성 → FIRST SEAT 접수 페이지 모듈 편집 → PC/모바일 미리보기 → 로컬 합성 접수/동의 저장. 공통 컴포넌트 샘플 포함.
5. 첫 실제 화면을 사용자에게 제시하고 검토 대기. 전체 작업 완료 전 시각 방향을 확인하는 프로젝트 규칙에 따른 체크포인트. 이후 승인을 반복 요청하지 않고 확정 방향으로 진행.
6. 심사·후보 확정·투표·결과·단일 접수/투표 전용 템플릿, 운영자 관리, 개인정보·파기·초기화 완성.
7. 독립 이벤트 A/B 회귀·보안·접근성·반응형·성능 검증 및 수정.
8. 승인된 새 인프라에 배포, 새 저장소 push, DNS/OAuth 전달표 실제 값 확정, 검증 호스트와 실제 회사 도메인에서 smoke test.
9. FIRST SEAT 실운영 전환이 필요하면 별도 범위 승인 후 수행. 기본 신규 개시안에서는 원본 변경 없음.
10. 최종 결과/운영 매뉴얼/검증 증거/비용·외부 미완료 항목 보고.

### 검증 및 완료 기준

| 검증 | 통과 기준 |
|---|---|
| 자동 검사 | 타입 검사·단위·통합·보안·build 모두 성공. 새 DB만 대상으로 실행 |
| 템플릿 | 개발자 코드 수정 없이 단일 접수·투표 전용 신규 생성, 복제는 설정만 복제하고 참여 이력은 0 |
| 페이지 빌더 | 추가/삭제/재정렬/문구/이미지/필드 검증·미리보기·공개가 실제 저장과 일치 |
| FIRST SEAT | 접수→검토 대기/승인/반려/후보→자동 숏리스트/확정→투표→득표순→단일 최종 후보→결과 공개 |
| 공개 전환 경쟁 | 확인한 후보/결과 snapshot 변경 시 409. 구버전 화면의 접수·투표도 마감/단계 전환 후 거절 |
| 이벤트 분리 | A의 ID를 B API에 사용한 상세·정책·후보·투표·열람·삭제 모두 거절. 전역 합계만 명시적으로 통합 |
| 동시성 | 중복 전송 한 건 저장, 투표 동시 요청 1회, 단계 전환과 참여 경쟁 원자 처리 |
| 동의 | 원문 수정 전후 receipt가 각 버전 유지. 누락/이벤트 다른 정책/만료 화면의 동의 차단 |
| 개인정보 | 원문은 별도 인증된 단건 조회에서만, audit 실패 시 차단, 60초/탭 비활성 제거, 로그·bundle·localStorage 미노출 |
| 초기화 | 합성 A만 초기화, A 보존 항목 유지, B의 행 수/내용 hash/투표 제한 변화 없음. 취소·재실행·만료·동시접수·실패 복구 검증 |
| 폼 안정성 | 입력 중 60초 갱신, focus 복귀, API 실패, 동의 변경에도 입력/포커스 유지. 단계 종료 안내 정상 |
| 인증 | 실제 회사 지정 계정 성공, 외부/유사 도메인/비활성 계정 실패. 브라우저 위조 신원 및 production dev bypass 거절 |
| 브라우저 | 최소 390px/1440px, 320px overflow, Safari/Chromium 핵심 동작, 키보드·focus·label·오류 연결·확대 검증 |
| 비용·부하 | 실제 비운영 환경 CPU/행 사용/용량·오류 측정. 무료 범위 적합 여부와 안전 운영량 보고 |
| 배포 | 새 repo commit/Worker 배포/Vercel 배포 확인, 새 DB binding 검증, TLS·OAuth·참여/조회 smoke test |

### 이번 검토에서 필요한 결정

1. 인프라: Vercel을 유지하며 Pro 최소 월 US$20 예산을 허용할지, 완전 무료 우선으로 Cloudflare 화면 호스팅까지 변경할지. 승인 없는 결제는 진행하지 않습니다.
2. 신규 D1 하나 + 기존 참여 데이터 이전 없이 FIRST SEAT 구성부터 등록하는 권장안에 동의하는지. 실제 참여 데이터 승계가 필요하면 이전 범위를 먼저 정합니다.
3. 관리자 주소 `events-admin.seoularena.net` 및 회사 계정 중 지정 운영자 허용 방식에 동의하는지. 최초 운영자 이메일은 구현 시 필요합니다.

위 기본안에 동의하면 Radix 기반 흑백 모듈 빌더, 제한된 이미지 업로드, 세 템플릿, 수동 전환·자동 마감 규칙도 승인 범위로 기록합니다. 데이터 이전/원본 전환/유료 증액은 자동 포함하지 않습니다.

### 현재 체크포인트

- STATUS: 계획 작성 완료, WAITING_FOR_REVIEW.
- ARTIFACT: 이 문서.
- FILES CHANGED: `outputs/events/PLATFORM_PLAN.md`, `.ai-work/tasks/events-platform-plan/{TASK,STATUS,DECISIONS,RESULT}.md`.
- TEST / BUILD: 미실행. 원격 커밋 대조·코드 및 문서 검토·공식 요금/라이선스 조사 수행.
- KNOWN ISSUES: 운영 상태/계정 플랜/실데이터 미확인, DNS target은 신규 발급 전, 구문서와 코드 일부 불일치.
- DECISIONS MADE: 기존 원본 불변, 계획만 작성. 설계 선택은 모두 제안이며 사용자 승인 대기.
- RECOMMENDED NEXT ACTION: 위 세 가지 결정과 전체 계획 검토 후 구현 범위 승인.
