# 티저 공개 목록 연동

GET /api/events/catalog/list에 image, startsAt, resultsAt 추가.
image는 현재 공개 단계의 헤더 asset URL.
기간은 events.started_at / events.ended_at의 저장값을 사용하며 운영자가 보정한 종료일도 유지.
예정 일정(event_stages.starts_at), 본문 날짜, 클라이언트 추정값은 사용하지 않음.
NULL은 미정. 기존 title/href/active와 정렬·공개 조건 유지.
DB migration 추가 없음. 배포 대상 events Data Worker.
