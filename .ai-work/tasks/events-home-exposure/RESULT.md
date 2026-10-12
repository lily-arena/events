# 구현 결과
- 지난 이벤트 h4 적용. 기존 FIRST SEAT은 마이그레이션 시 지난 이벤트 기본값.
- 대시보드 상태 칼럼에서 진행중 노출/지난 이벤트 전환. 일정·공개 여부 독립.
- 신규 API GET /api/events/catalog/list, POST /api/admin/events/:id/home-exposure.
- migration: migrations/events/0008_home_exposure.sql.
- 주요 변경: EventsLanding.tsx/events.css, AdminApp.tsx/AdminPreview.tsx/admin.css, data repository/catalog/RPC, public/admin Worker, relay cache.
- 검증: 169 tests / 40 files 통과; check:events 및 build:events 통과. 브라우저 실제 컴포넌트 모바일390px/데스크톱1440px 확인. HTTP 응답은 테스트 fixture이며 운영 DB 연결 테스트는 아님.
- 브라우저 검증: tests/platform/browser-home.mjs (Vite events 5191 필요).
- 운영 배포 미실행. 배포 승인 후 DB migration → data Worker → admin/public Workers → Vercel 순서 적용 필요.
- 기존 관련 없는 미추적 파일 유지. 커밋/푸시 없음.
