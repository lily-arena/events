/**
 * 화면에 쓰는 우리말 표기.
 * 내부 코드값을 그대로 보여주지 않는다.
 */

export const STATE_LABEL: Readonly<Record<string, string>> = {
  DRAFT: '준비 중',
  SUBMISSION_OPEN: '문구 접수 중',
  SUBMISSION_CLOSED: '접수 마감',
  VOTING_READY: '투표 준비 완료',
  VOTING_OPEN: '투표 진행 중',
  VOTING_CLOSED: '투표 마감',
  RESULT_READY: '결과 준비 완료',
  RESULT_PUBLISHED: '결과 공개됨',
  ARCHIVED: '종료',
};

export const REVIEW_STATUS_LABEL: Readonly<Record<string, string>> = {
  PENDING: '검토 대기',
  APPROVED: '승인',
  REJECTED: '반려',
  CANDIDATE: '후보',
  WITHDRAWN: '철회',
};

/** 상태별 색 구분. 색만으로 구분하지 않고 항상 글자를 함께 보여준다. */
/** 상태별 색. 색만으로 구분하지 않고 항상 글자를 함께 보여준다. */
export function statusTone(status: string): 'ok' | 'wait' | 'no' | 'pick' | '' {
  if (status === 'CANDIDATE') return 'pick';
  if (status === 'APPROVED' || status === 'INCLUDED' || status === 'PUBLISHED' || status === 'VERIFIED') return 'ok';
  if (status === 'PENDING' || status === 'DRAFT' || status === 'APPROVED_WAITING') return 'wait';
  if (status === 'REJECTED' || status === 'EXCLUDED' || status === 'VOID' || status === 'FAILED') return 'no';
  return '';
}

export const PAGE_LABEL: Readonly<Record<string, string>> = {
  SUBMISSION: '문구 접수 화면',
  SUBMITTED: '접수 완료 화면',
  VOTING: '투표 화면',
  VOTED: '투표 완료 화면',
  WAITING: '대기 안내 화면',
  RESULT: '결과 발표 화면',
};

export const CONTENT_STATUS_LABEL: Readonly<Record<string, string>> = {
  DRAFT: '작성 중',
  APPROVED: '승인됨',
  PUBLISHED: '게시 중',
  SUPERSEDED: '지난 버전',
};

export const BLOCK_LABEL: Readonly<Record<string, string>> = {
  hero: '큰 제목',
  intro: '소개 문단',
  headline: '안내 제목',
  lead: '안내 문장',
  back: '돌아가기 버튼',
  exclusion_heading: '제외 기준 제목',
  exclusions: '제외 기준 항목',
  message_label: '문구 입력 제목',
  message_helper: '문구 입력 도움말',
  entrant_heading: '응모자 정보 제목',
  entrant_helper: '응모자 정보 안내',
  privacy_label: '개인정보 동의 문구',
  license_label: '저작권 동의 문구',
  notices_heading: '유의사항 제목',
  notices: '유의사항 항목',
  submit: '제출 버튼',
  vote_submit: '투표 버튼',
};

export const DELETION_KIND_LABEL: Readonly<Record<string, string>> = {
  CONTACT: '연락처(이름·전화·이메일)',
  SUBMISSION: '응모작 전체',
  VOTER: '투표 참여 기록',
  RISK: '보안 점검 기록',
  CONSENT: '동의 기록',
};

export const DELETION_STATE_LABEL: Readonly<Record<string, string>> = {
  PENDING: '대기 중',
  INTENT_ARCHIVED: '파기 예고 보관됨',
  DELETED: '삭제 완료',
  VERIFIED: '파기 확인 완료',
  FAILED: '실패 · 재시도 필요',
};

export const AUDIT_ACTION_LABEL: Readonly<Record<string, string>> = {
  SUBMISSION_ACCEPTED: '문구 접수',
  SUBMISSION_REVIEWED: '심사 결과 저장',
  PII_MASK_VIEWED: '가린 개인정보 확인',
  PII_REVEAL_GRANTED: '원문 열람 승인',
  PII_REVEAL_INTENT: '원문 열람 시작',
  PII_REVEALED: '원문 열람',
  SHORTLIST_CONFIRMED: '후보 확정',
  SHORTLIST_REORDERED: '후보 순서 변경',
  FINAL_MESSAGE_CONFIRMED: '최종 문구 확정',
  CONTENT_FIELD_SAVED: '화면 문구 저장',
  CAMPAIGN_ACTION_EXECUTED: '공개 전환',
  CAMPAIGN_CLOSED_ON_SCHEDULE: '예정 마감',
  VOTE_ACCEPTED: '투표 접수',
  VOTE_DECIDED: '표 판정',
  JURY_SCORED: '심사 점수 저장',
  CONTENT_DRAFT_CREATED: '문구 초안 생성',
  CONTENT_DRAFT_EDITED: '문구 초안 수정',
  CONTENT_APPROVED: '문구 승인',
  CONTENT_PUBLISHED: '문구 게시',
  CAMPAIGN_CONFIG_UPDATED: '설정 변경',
  CAMPAIGN_PAUSED: '참여 일시 중단',
  CAMPAIGN_RESUMED: '참여 재개',
  CAMPAIGN_TRANSITIONED: '단계 전환',
  RESULT_DRAFTED: '결과 산출',
  RESULT_APPROVED: '결과 승인',
  RESULT_PUBLISHED: '결과 공개',
  RESULT_MEDIA_UPDATED: '결과 사진 변경',
  POLICY_DRAFTED: '약관 초안',
  POLICY_APPROVED: '약관 승인',
  POLICY_ACTIVATED: '약관 적용',
  DELETION_REQUESTED: '개인정보 파기 예약',
  DELETION_VERIFIED: '개인정보 파기 확인',
};

export function kst(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
